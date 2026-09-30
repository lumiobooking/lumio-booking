import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { bucketFor } from './payment-methods';

/**
 * Cashier shifts — "ca thu ngân".
 *
 * A till is opened with a counted float, every sale rung up while it is open
 * carries the shift id, cash put in or taken out is logged with a reason, and
 * at close the cashier counts the drawer against what the system expects:
 *
 *     expected = opening float + cash tendered − change given + cash in − cash out
 *
 * The close freezes a summary on the row. Printed hand-over sheets are read
 * from that snapshot, so a sale voided next week does not silently rewrite
 * what the cashier signed for last night.
 *
 * One open shift per salon (tenant) at a time. Branches are separate tenants,
 * so a chain gets one drawer per shop, which is how the money actually sits.
 */

export type MovementKind = 'IN' | 'OUT';

export interface ShiftSummary {
  orders: number;
  revenueCents: number;
  tipsCents: number;
  byMethod: { cashCents: number; cardCents: number; otherCents: number; giftCardCents: number };
  byTender: Record<string, number>;
  changeCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCashCents: number;
  movements: { id: string; kind: MovementKind; amountCents: number; reason: string | null; byName: string | null; at: string }[];
}

type ShiftRow = {
  id: string; tenantId: string; status: string;
  openedByUserId: string | null; openedByName: string | null; openedAt: Date; openingCents: number; openNote: string | null;
  closedByUserId: string | null; closedByName: string | null; closedAt: Date | null;
  expectedCashCents: number | null; countedCents: number | null; varianceCents: number | null; closeNote: string | null;
  summary: ShiftSummary | null;
};

const MAX_CENTS = 100_000_000_00; // a hundred million in the salon's currency — a typo guard, not a business rule

@Injectable()
export class CashShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // The generated client on some machines predates these tables; the loose
  // handle keeps the build green there and costs nothing on Render, where the
  // client is regenerated on every deploy.
  private get db() { return this.prisma as unknown as Record<string, any>; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async nameOf(user: AuthenticatedUser): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true, email: true } }).catch(() => null);
    if (!u) return null;
    return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || null;
  }

  private cents(v: unknown, what: string): number {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MAX_CENTS) throw new BadRequestException(`${what}: số tiền không hợp lệ.`);
    return n;
  }

  /** The salon's open shift, or null. Used by checkout to tag the sale. */
  async openShiftId(tenantId: string): Promise<string | null> {
    const row = await this.db.cashShift.findFirst({ where: { tenantId, status: 'OPEN' }, select: { id: true } }) as { id: string } | null;
    return row?.id ?? null;
  }

  /** Live totals for a shift — sales tagged with it (paid only) plus its cash movements. */
  async summarize(tenantId: string, shift: { id: string; openingCents: number }): Promise<ShiftSummary> {
    type OrderLite = { totalCents: number; tipCents: number; changeCents: number | null; giftCardAppliedCents: number | null; tenders: { method: string; amountCents: number }[] };
    type MoveRow = { id: string; kind: MovementKind; amountCents: number; reason: string | null; byName: string | null; createdAt: Date };
    const [orders, moves] = await Promise.all([
      this.db.order.findMany({
        // 'PAID' only: a voided or refunded sale put no money in the drawer.
        where: { tenantId, status: 'PAID', shiftId: shift.id },
        select: { totalCents: true, tipCents: true, changeCents: true, giftCardAppliedCents: true, tenders: { select: { method: true, amountCents: true } } },
      }) as Promise<OrderLite[]>,
      this.db.cashMovement.findMany({ where: { tenantId, shiftId: shift.id }, orderBy: { createdAt: 'asc' } }) as Promise<MoveRow[]>,
    ]);
    const byMethod = { cashCents: 0, cardCents: 0, otherCents: 0, giftCardCents: 0 };
    const byTender: Record<string, number> = {};
    let revenue = 0, tips = 0, change = 0;
    for (const o of orders) {
      revenue += o.totalCents;
      tips += o.tipCents;
      byMethod.giftCardCents += o.giftCardAppliedCents ?? 0;
      let cashHere = false;
      for (const t of o.tenders ?? []) {
        const b = bucketFor(t.method);
        if (b === 'cash') { byMethod.cashCents += t.amountCents; cashHere = true; }
        else if (b === 'card') byMethod.cardCents += t.amountCents;
        else byMethod.otherCents += t.amountCents;
        byTender[t.method] = (byTender[t.method] ?? 0) + t.amountCents;
      }
      // Change only ever leaves the drawer when cash came in on that bill.
      if (cashHere) change += o.changeCents ?? 0;
    }
    let cashIn = 0, cashOut = 0;
    for (const m of moves) { if (m.kind === 'IN') cashIn += m.amountCents; else cashOut += m.amountCents; }
    const expected = shift.openingCents + byMethod.cashCents - change + cashIn - cashOut;
    return {
      orders: orders.length,
      revenueCents: revenue,
      tipsCents: tips,
      byMethod,
      byTender,
      changeCents: change,
      cashInCents: cashIn,
      cashOutCents: cashOut,
      expectedCashCents: expected,
      movements: moves.map((m: MoveRow) => ({ id: m.id, kind: m.kind, amountCents: m.amountCents, reason: m.reason, byName: m.byName, at: m.createdAt.toISOString() })),
    };
  }

  private view(s: ShiftRow) {
    return {
      id: s.id, status: s.status,
      openedByName: s.openedByName, openedAt: s.openedAt.toISOString(), openingCents: s.openingCents, openNote: s.openNote,
      closedByName: s.closedByName, closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      expectedCashCents: s.expectedCashCents, countedCents: s.countedCents, varianceCents: s.varianceCents, closeNote: s.closeNote,
    };
  }

  /** What the till shows: the open shift with live totals, or nothing — plus whether a shift is required to sell. */
  async current(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const pos = await this.settings.getPosSettings(tenantId);
    const requireShift = Boolean((pos as { requireShift?: boolean }).requireShift);
    const s = await this.db.cashShift.findFirst({ where: { tenantId, status: 'OPEN' } }) as ShiftRow | null;
    if (!s) return { requireShift, shift: null, summary: null };
    return { requireShift, shift: this.view(s), summary: await this.summarize(tenantId, s) };
  }

  async open(user: AuthenticatedUser, dto: { openingCents?: number; note?: string }) {
    const tenantId = this.tenantId(user);
    const opening = this.cents(dto.openingCents ?? 0, 'Tiền đầu ca');
    const existing = await this.db.cashShift.findFirst({ where: { tenantId, status: 'OPEN' }, select: { id: true, openedByName: true } }) as { id: string; openedByName: string | null } | null;
    if (existing) throw new BadRequestException(`Đang có ca mở${existing.openedByName ? ` (${existing.openedByName})` : ''} — chốt ca đó trước.`);
    const name = await this.nameOf(user);
    const s = await this.db.cashShift.create({
      data: { tenantId, status: 'OPEN', openedByUserId: user.userId, openedByName: name, openingCents: opening, openNote: (dto.note ?? '').toString().trim().slice(0, 300) || null },
    }) as ShiftRow;
    await this.audit.log({ tenantId, userId: user.userId, action: 'pos.shift_opened', resourceType: 'cash_shift', resourceId: s.id, metadata: { openingCents: opening } });
    return { shift: this.view(s), summary: await this.summarize(tenantId, s) };
  }

  async addMovement(user: AuthenticatedUser, dto: { kind?: string; amountCents?: number; reason?: string }) {
    const tenantId = this.tenantId(user);
    const s = await this.db.cashShift.findFirst({ where: { tenantId, status: 'OPEN' } }) as ShiftRow | null;
    if (!s) throw new BadRequestException('Chưa vào ca — vào ca trước khi ghi thu/chi.');
    const kind: MovementKind = dto.kind === 'OUT' ? 'OUT' : dto.kind === 'IN' ? 'IN' : (() => { throw new BadRequestException('Loại phải là IN hoặc OUT.'); })();
    const amount = this.cents(dto.amountCents, 'Số tiền');
    if (amount === 0) throw new BadRequestException('Số tiền phải lớn hơn 0.');
    const reason = (dto.reason ?? '').toString().trim().slice(0, 200);
    if (!reason) throw new BadRequestException('Ghi lý do thu/chi.');
    const name = await this.nameOf(user);
    const m = await this.db.cashMovement.create({ data: { tenantId, shiftId: s.id, kind, amountCents: amount, reason, byUserId: user.userId, byName: name } });
    await this.audit.log({ tenantId, userId: user.userId, action: kind === 'IN' ? 'pos.cash_in' : 'pos.cash_out', resourceType: 'cash_shift', resourceId: s.id, metadata: { amountCents: amount, reason, movementId: m.id } });
    return { shift: this.view(s), summary: await this.summarize(tenantId, s) };
  }

  async removeMovement(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const m = await this.db.cashMovement.findFirst({ where: { id, tenantId }, include: { shift: true } }) as ({ id: string; shiftId: string; shift: ShiftRow } | null);
    if (!m) throw new NotFoundException('Không thấy khoản thu/chi này.');
    if (m.shift.status !== 'OPEN') throw new BadRequestException('Ca đã chốt — không sửa được nữa.');
    await this.db.cashMovement.delete({ where: { id: m.id } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'pos.cash_movement_removed', resourceType: 'cash_shift', resourceId: m.shiftId, metadata: { movementId: m.id } });
    return { shift: this.view(m.shift), summary: await this.summarize(tenantId, m.shift) };
  }

  async close(user: AuthenticatedUser, dto: { countedCents?: number; note?: string }) {
    const tenantId = this.tenantId(user);
    const s = await this.db.cashShift.findFirst({ where: { tenantId, status: 'OPEN' } }) as ShiftRow | null;
    if (!s) throw new BadRequestException('Không có ca nào đang mở.');
    const counted = this.cents(dto.countedCents, 'Tiền đếm được');
    const summary = await this.summarize(tenantId, s);
    const name = await this.nameOf(user);
    const closed = await this.db.cashShift.update({
      where: { id: s.id },
      data: {
        status: 'CLOSED', closedByUserId: user.userId, closedByName: name, closedAt: new Date(),
        expectedCashCents: summary.expectedCashCents, countedCents: counted, varianceCents: counted - summary.expectedCashCents,
        closeNote: (dto.note ?? '').toString().trim().slice(0, 500) || null,
        summary: summary as unknown as object,
      },
    }) as ShiftRow;
    await this.audit.log({ tenantId, userId: user.userId, action: 'pos.shift_closed', resourceType: 'cash_shift', resourceId: s.id, metadata: { expectedCashCents: summary.expectedCashCents, countedCents: counted, varianceCents: counted - summary.expectedCashCents } });
    return { shift: this.view(closed), summary };
  }

  /** Past shifts, newest first. */
  async list(user: AuthenticatedUser, fromStr?: string, toStr?: string, take = 60) {
    const tenantId = this.tenantId(user);
    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 60 * 86400000);
    const to = toStr ? new Date(toStr) : new Date(Date.now() + 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Khoảng ngày không hợp lệ.');
    const rows = await this.db.cashShift.findMany({
      where: { tenantId, openedAt: { gte: from, lte: to } },
      orderBy: { openedAt: 'desc' },
      take: Math.min(200, Math.max(1, take)),
    }) as ShiftRow[];
    return rows.map((s) => ({
      ...this.view(s),
      orders: s.summary?.orders ?? null,
      revenueCents: s.summary?.revenueCents ?? null,
      cashCents: s.summary?.byMethod?.cashCents ?? null,
    }));
  }

  /** One shift with its summary — frozen if closed, live if still open. */
  async detail(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const s = await this.db.cashShift.findFirst({ where: { id, tenantId } }) as ShiftRow | null;
    if (!s) throw new NotFoundException('Không thấy ca này.');
    const summary = s.status === 'CLOSED' && s.summary ? s.summary : await this.summarize(tenantId, s);
    return { shift: this.view(s), summary };
  }
}
