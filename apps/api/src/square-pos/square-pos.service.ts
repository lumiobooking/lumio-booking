/**
 * Square POS sync — the database half. Rules in square-pos.logic.ts.
 *
 * Tenant: always the signed-in salon (or, for the background run, the salon
 * whose own setting turned it on). The Square token is that salon's own,
 * read from its Payment terminals connection; nothing here ever reads or
 * writes another salon's rows.
 */
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppointmentStatus, OrderItemKind, OrderStatus, PaymentStatus, PaymentType, WalkInStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CredentialStore } from '../payments-hub/credential-store.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { dayKeyTz } from '../common/salon-time';
import { phoneTail } from '../customers/import-rows';
import { dialCodeFor, toE164 } from '../common/phone';
import { ledgerProviderFor } from '../pos/payment-methods';
import { SquarePosApi } from './square-pos.api';
import {
  CLIENT_REF_PREFIX, MAX_BACKFILL_DAYS, SETTING_KEY, SyncSettings,
  buildTicket, byOrder, cleanStaffMap, isPosPayment, menuToCatalog, methodOf, pickBooking, readSettings, remember, syncWindow,
  type Candidate, type SqPayment,
} from './square-pos.logic';

const LIVE: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED, AppointmentStatus.ARRIVED];
const MAX_ORDERS_PER_RUN = 300;
const SWEEP_MS = 5 * 60_000;

export interface SyncResult { imported: number; matched: number; skipped: number; refunds: number; customers: number; complete: boolean }

@Injectable()
export class SquarePosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SquarePos');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly busy = new Set<string>();
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly creds: CredentialStore,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    const on = (process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';
    if (!on) return;
    this.timer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private tenantOf(user: AuthenticatedUser): string {
    const t = resolveTenantScope(user);
    if (!t) throw new BadRequestException('No salon in scope');
    return t;
  }

  private async load(tenantId: string): Promise<SyncSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SETTING_KEY } } });
    return readSettings(row?.value);
  }

  private async save(tenantId: string, s: SyncSettings) {
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: SETTING_KEY } },
      create: { tenantId, key: SETTING_KEY, value: s as never },
      update: { value: s as never },
    });
  }

  private async api(tenantId: string): Promise<SquarePosApi> {
    let cred;
    try { cred = await this.creds.loadCred(tenantId, 'square' as never); } catch {
      throw new BadRequestException('Connect Square on the Payment terminals page first');
    }
    return new SquarePosApi(cred.secret, cred.locationId);
  }

  // ---- the screen -----------------------------------------------------------

  async status(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const [s, conn, staff, imported] = await Promise.all([
      this.load(tenantId),
      this.prisma.paymentConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'square' } }, select: { status: true } }),
      this.prisma.staffMember.findMany({ where: { tenantId, isActive: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } }),
      this.prisma.order.count({ where: { tenantId, source: 'square' } }),
    ]);
    const connected = conn?.status === 'ACTIVE';
    let teamMembers: { id: string; name: string; staffId: string | null }[] = [];
    let squareError: string | null = null;
    if (connected) {
      try {
        const api = await this.api(tenantId);
        const loc = await api.location();
        if (loc) teamMembers = (await api.teamMembers(loc.id)).map((m) => ({ ...m, staffId: s.staffMap[m.id] ?? null }));
      } catch (e) { squareError = (e as Error).message.slice(0, 200); }
    }
    return {
      connected,
      enabled: s.enabled,
      since: s.since,
      pushCustomers: s.pushCustomers,
      lastRunAt: s.lastRunAt,
      lastOkAt: s.lastOkAt,
      lastError: s.lastError,
      last: s.last,
      importedTickets: imported,
      teamMembers,
      squareError,
      staff: staff.map((x) => ({ id: x.id, name: `${x.firstName}${x.lastName ? ` ${x.lastName}` : ''}` })),
    };
  }

  async update(user: AuthenticatedUser, dto: { enabled?: unknown; since?: unknown; staffMap?: unknown; pushCustomers?: unknown }) {
    const tenantId = this.tenantOf(user);
    const s = await this.load(tenantId);
    const before = { enabled: s.enabled, since: s.since };
    if (dto.enabled !== undefined) {
      if (dto.enabled === true) {
        const conn = await this.prisma.paymentConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'square' } }, select: { status: true } });
        if (conn?.status !== 'ACTIVE') throw new BadRequestException('Connect Square on the Payment terminals page first');
        if (!s.enabled && !s.since) s.since = new Date().toISOString();
      }
      s.enabled = dto.enabled === true;
    }
    if (dto.since !== undefined) {
      const d = new Date(String(dto.since));
      const now = Date.now();
      if (Number.isNaN(d.getTime()) || d.getTime() > now + 60_000 || d.getTime() < now - MAX_BACKFILL_DAYS * 86_400_000) {
        throw new BadRequestException(`Start date must be within the last ${MAX_BACKFILL_DAYS} days`);
      }
      if (d.toISOString() !== s.since) { s.since = d.toISOString(); s.lastOkAt = null; }
    }
    if (dto.staffMap !== undefined) {
      const own = await this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true } });
      s.staffMap = cleanStaffMap(dto.staffMap, new Set(own.map((x) => x.id)));
    }
    if (dto.pushCustomers !== undefined) s.pushCustomers = dto.pushCustomers === true;
    await this.save(tenantId, s);
    await this.audit.log({ tenantId, userId: user.userId, action: 'square_pos.settings_updated', resourceType: 'tenant', resourceId: tenantId, metadata: { before, enabled: s.enabled, since: s.since, mapped: Object.keys(s.staffMap).length, pushCustomers: s.pushCustomers } });
    return this.status(user);
  }

  async syncNow(user: AuthenticatedUser): Promise<SyncResult> {
    const tenantId = this.tenantOf(user);
    const s = await this.load(tenantId);
    if (!s.enabled) throw new BadRequestException('Turn on the Square POS sync first');
    return this.syncTenant(tenantId, user.userId);
  }

  /** Send the menu to Square's item library (only names Square does not have yet). */
  async pushMenu(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const api = await this.api(tenantId);
    const loc = await api.location();
    const services = await this.prisma.service.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, priceCents: true }, orderBy: { name: 'asc' } });
    const objects = menuToCatalog(services, await api.itemNames(), loc?.currency ?? 'USD');
    const added = objects.length ? await api.upsertItems(objects) : 0;
    await this.audit.log({ tenantId, userId: user.userId, action: 'square_pos.menu_pushed', resourceType: 'tenant', resourceId: tenantId, metadata: { added, services: services.length } });
    return { added, alreadyThere: services.length - added };
  }

  // ---- the run --------------------------------------------------------------

  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const rows = await this.prisma.setting.findMany({ where: { key: SETTING_KEY }, select: { tenantId: true, value: true } });
      for (const r of rows) {
        if (!readSettings(r.value).enabled) continue;
        const t = await this.prisma.tenant.findUnique({ where: { id: r.tenantId }, select: { status: true } }).catch(() => null);
        if (!t || t.status !== 'ACTIVE') continue;
        await this.syncTenant(r.tenantId, null).catch((e) => this.log.warn(`square pos sync ${r.tenantId}: ${(e as Error).message}`));
      }
    } finally { this.sweeping = false; }
  }

  async syncTenant(tenantId: string, userId: string | null, now = new Date()): Promise<SyncResult> {
    if (this.busy.has(tenantId)) return { imported: 0, matched: 0, skipped: 0, refunds: 0, customers: 0, complete: false };
    this.busy.add(tenantId);
    const s = await this.load(tenantId);
    try {
      const r = await this.run(tenantId, s, now);
      s.lastRunAt = now.toISOString();
      if (r.complete) s.lastOkAt = now.toISOString();
      s.lastError = null;
      s.last = { imported: r.imported, matched: r.matched, skipped: r.skipped, refunds: r.refunds, customers: r.customers };
      await this.save(tenantId, s);
      if (r.imported || r.refunds) {
        await this.audit.log({ tenantId, userId, action: 'square_pos.synced', resourceType: 'tenant', resourceId: tenantId, metadata: { ...s.last } });
      }
      return r;
    } catch (e) {
      s.lastRunAt = now.toISOString();
      s.lastError = String((e as Error).message || e).slice(0, 300);
      await this.save(tenantId, s).catch(() => undefined);
      throw e;
    } finally {
      this.busy.delete(tenantId);
    }
  }

  private async run(tenantId: string, s: SyncSettings, now: Date): Promise<SyncResult> {
    const api = await this.api(tenantId);
    const loc = await api.location();
    if (!loc) throw new BadRequestException('This Square account has no location');
    const { from, to } = syncWindow(s, now);
    const { payments, complete } = await api.payments(from, to, loc.id);
    const groups = byOrder(payments.filter(isPosPayment));

    // Bills already in Lumio are not read again.
    const refs = [...groups.keys()].map((id) => `${CLIENT_REF_PREFIX}${id}`);
    const have = refs.length
      ? new Set((await this.prisma.order.findMany({ where: { tenantId, clientRef: { in: refs } }, select: { clientRef: true } })).map((o) => String(o.clientRef).slice(CLIENT_REF_PREFIX.length)))
      : new Set<string>();
    const todo = [...groups.keys()].filter((id) => !have.has(id)).slice(0, MAX_ORDERS_PER_RUN);
    const orders = todo.length ? (await api.orders(todo, loc.id)).filter((o) => o.state === 'COMPLETED') : [];

    const [tenant, services, staff, runs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, market: true } }),
      this.prisma.service.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true } }),
      this.prisma.payrollRun.findMany({ where: { tenantId, status: 'FINAL' }, select: { periodFrom: true, periodTo: true } }),
    ]);
    const tz = tenant?.timezone || 'UTC';
    const market = String(tenant?.market ?? 'US').toUpperCase();
    const dial = dialCodeFor(market, tenant?.timezone);
    const ownStaff = new Set(staff.map((x) => x.id));
    const people = new Map<string, { phone: string | null; firstName: string | null; lastName: string | null } | null>();
    const personOf = async (id: string | null | undefined) => {
      if (!id) return null;
      if (!people.has(id)) people.set(id, await api.customer(id));
      return people.get(id) ?? null;
    };

    const res: SyncResult = { imported: 0, matched: 0, skipped: 0, refunds: 0, customers: 0, complete };
    for (const order of orders) {
      const pays = groups.get(order.id) ?? [];
      const first: SqPayment | undefined = pays[0];
      const tm = first?.team_member_id || first?.employee_id || '';
      const mapped = tm ? s.staffMap[tm] : undefined;
      const staffId = mapped && ownStaff.has(mapped) ? mapped : null;
      const person = await personOf(order.customer_id || pays.find((p) => p.customer_id)?.customer_id);
      const draft = buildTicket(order, pays, { services, staffId });
      const day = dayKeyTz(draft.paidAt, tz);
      if (runs.some((p) => day >= p.periodFrom && day <= p.periodTo)) { res.skipped += 1; continue; }

      const booking = await this.matchBooking(tenantId, draft.paidAt, person?.phone ?? null, staffId);
      const lineStaff = booking?.assignedStaffId ?? staffId;
      const ticket = lineStaff !== staffId ? buildTicket(order, pays, { services, staffId: lineStaff }) : draft;
      const customerId = booking?.customerId ?? await this.customerFor(tenantId, person, dial);
      const ok = await this.write(tenantId, ticket, { customerId, appointmentId: booking?.id ?? null, currency: loc.currency });
      if (ok) { res.imported += 1; if (booking) res.matched += 1; } else res.skipped += 1;
    }

    res.refunds = await this.refunds(tenantId, api, s, from, to, loc.id, loc.currency);
    if (s.pushCustomers) res.customers = await this.pushCustomers(tenantId, api, s, now);
    return res;
  }

  /** The booking this bill paid for, among THIS salon's open bookings not yet paid at a till. */
  private async matchBooking(tenantId: string, paidAt: Date, phone: string | null, staffId: string | null): Promise<(Candidate & { id: string }) | null> {
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId, status: { in: LIVE }, startTime: { gte: new Date(paidAt.getTime() - 8 * 3_600_000), lte: new Date(paidAt.getTime() + 3_600_000) } },
      select: { id: true, startTime: true, endTime: true, assignedStaffId: true, customerId: true, customer: { select: { phone: true } } },
      take: 200,
    });
    if (!rows.length) return null;
    const ids = rows.map((r) => r.id);
    const paid = await this.prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, OR: [{ appointmentId: { in: ids } }, { appointmentIds: { hasSome: ids } }] },
      select: { appointmentId: true, appointmentIds: true },
    });
    const taken = new Set<string>();
    for (const o of paid) { if (o.appointmentId) taken.add(o.appointmentId); for (const x of o.appointmentIds ?? []) taken.add(x); }
    const cands: Candidate[] = rows.filter((r) => !taken.has(r.id)).map((r) => ({
      id: r.id, startTime: r.startTime, endTime: r.endTime, assignedStaffId: r.assignedStaffId, customerId: r.customerId, customerPhone: r.customer?.phone ?? null,
    }));
    const hit = pickBooking(cands, { phone, staffId, paidAt });
    return hit ? cands.find((c) => c.id === hit.id) ?? null : null;
  }

  /** The Lumio client with this Square client's phone; added when there is none. */
  private async customerFor(tenantId: string, person: { phone: string | null; firstName: string | null; lastName: string | null } | null, dial: string): Promise<string | null> {
    const tail = phoneTail(person?.phone);
    if (!tail || !person?.phone) return null;
    const hit = await this.prisma.customer.findFirst({ where: { tenantId, phone: { endsWith: tail } }, select: { id: true } });
    if (hit) return hit.id;
    const created = await this.prisma.customer.create({
      data: { tenantId, firstName: (person.firstName || 'Khách').slice(0, 100), lastName: person.lastName?.slice(0, 100) || null, phone: toE164(person.phone, dial) ?? person.phone, importSource: 'square', importedAt: new Date() } as never,
      select: { id: true },
    }).catch(() => null);
    return created?.id ?? null;
  }

  /** One paid ticket, exactly as the till writes one. False when another run wrote it first. */
  private async write(tenantId: string, t: ReturnType<typeof buildTicket>, link: { customerId: string | null; appointmentId: string | null; currency: string }): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const last = await tx.order.findFirst({ where: { tenantId }, orderBy: { orderNumber: 'desc' }, select: { orderNumber: true } });
          const order = await tx.order.create({
            data: {
              tenantId,
              orderNumber: (last?.orderNumber ?? 0) + 1,
              status: OrderStatus.PAID,
              customerId: link.customerId,
              appointmentId: link.appointmentId,
              appointmentIds: link.appointmentId ? [link.appointmentId] : [],
              source: 'square',
              createdByUserId: null,
              subtotalCents: t.subtotal,
              discountCents: t.discount,
              taxCents: t.tax,
              tipCents: t.tip,
              totalCents: t.total,
              paidCents: t.total,
              changeCents: 0,
              currency: link.currency,
              note: `Square POS${t.receipt ? ` · #${t.receipt}` : ''}`.slice(0, 500),
              clientRef: `${CLIENT_REF_PREFIX}${t.squareOrderId}`,
              createdAt: t.paidAt,
              paidAt: t.paidAt,
            },
            select: { id: true },
          });
          await tx.orderItem.createMany({
            data: t.lines.map((l) => ({
              tenantId, orderId: order.id, kind: OrderItemKind.SERVICE, serviceId: l.serviceId, productId: null, name: l.name,
              unitPriceCents: l.amount, quantity: 1, discountCents: 0, taxCents: 0, tipCents: l.tip,
              lineTotalCents: l.amount, staffMemberId: l.staffId, createdAt: t.paidAt,
            })),
          });
          for (const td of t.tenders) {
            await tx.orderPayment.create({ data: { tenantId, orderId: order.id, method: td.method as never, amountCents: td.amount, createdAt: t.paidAt } });
            await tx.payment.create({
              data: {
                tenantId, appointmentId: null, amountCents: td.amount, currency: link.currency,
                type: PaymentType.PAY_LATER, status: PaymentStatus.PAID, provider: ledgerProviderFor(td.method),
                providerReference: `order:${order.id}`, paidAt: t.paidAt, createdAt: t.paidAt,
              },
            });
          }
          if (link.appointmentId) {
            await tx.appointment.updateMany({
              where: { id: link.appointmentId, tenantId, status: { in: LIVE } },
              data: { status: AppointmentStatus.COMPLETED, completedAt: t.paidAt },
            });
            // A balance row written by an earlier "Complete" is replaced by the real money.
            await tx.payment.updateMany({
              where: { tenantId, appointmentId: link.appointmentId, status: PaymentStatus.PAID, type: PaymentType.PAY_LATER, providerReference: null },
              data: { status: PaymentStatus.REFUNDED, providerReference: `superseded:order:${order.id}` },
            });
            await tx.walkIn.updateMany({
              where: { tenantId, appointmentId: link.appointmentId, status: { not: WalkInStatus.DONE } },
              data: { status: WalkInStatus.DONE, doneAt: t.paidAt },
            });
          }
        }, { timeout: 30_000 });
        return true;
      } catch (e) {
        const code = (e as { code?: string }).code;
        const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
        // Written by a run at the same moment: that is the ticket.
        if (code === 'P2002' && /clientRef|client_ref/.test(target)) return false;
        if (attempt === 1) throw e;
      }
    }
    return false;
  }

  /** Refunds made on Square for bills that are in Lumio: one negative row each, once. */
  private async refunds(tenantId: string, api: SquarePosApi, s: SyncSettings, from: Date, to: Date, locationId: string, currency: string): Promise<number> {
    const list = (await api.refunds(from, to, locationId)).filter((r) => r.status === 'COMPLETED' && !s.refundsDone.includes(r.id));
    let n = 0;
    const done: string[] = [];
    for (const r of list) {
      const p = r.payment_id ? await api.payment(r.payment_id) : null;
      if (!p) continue;
      done.push(r.id);
      if (!p.order_id || !isPosPayment({ ...p, status: 'COMPLETED' })) continue;
      const order = await this.prisma.order.findFirst({ where: { tenantId, clientRef: `${CLIENT_REF_PREFIX}${p.order_id}` }, select: { id: true } });
      const cents = Math.round(r.amount_money?.amount ?? 0);
      if (!order || cents <= 0) continue;
      await this.prisma.payment.create({
        data: {
          tenantId, appointmentId: null, amountCents: -cents, currency, type: PaymentType.PAY_LATER, status: PaymentStatus.PAID,
          provider: ledgerProviderFor(methodOf(p)), providerReference: `order:${order.id}`,
          paidAt: r.created_at ? new Date(r.created_at) : new Date(), createdAt: r.created_at ? new Date(r.created_at) : new Date(),
        },
      });
      n += 1;
    }
    s.refundsDone = remember(s.refundsDone, done);
    return n;
  }

  /** Today's and tomorrow's clients onto Square's customer list, so the front desk finds them there. */
  private async pushCustomers(tenantId: string, api: SquarePosApi, s: SyncSettings, now: Date): Promise<number> {
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId, status: { in: LIVE }, startTime: { gte: new Date(now.getTime() - 3_600_000), lte: new Date(now.getTime() + 24 * 3_600_000) }, id: { notIn: s.customersPushed } },
      select: { id: true, customer: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { startTime: 'asc' },
      take: 40,
    });
    let n = 0;
    const done: string[] = [];
    for (const r of rows) {
      const phone = r.customer?.phone;
      if (!phone || !phone.startsWith('+')) { done.push(r.id); continue; }
      try {
        if ((await api.ensureCustomer({ phone, firstName: r.customer!.firstName || 'Client', lastName: r.customer!.lastName ?? null })) === 'created') n += 1;
        done.push(r.id);
      } catch { /* tried again next run */ }
    }
    s.customersPushed = remember(s.customersPushed, done);
    return n;
  }
}
