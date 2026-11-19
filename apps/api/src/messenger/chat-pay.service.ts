import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { RESTAURANT_SETTINGS_KEY, resolvePayAccount } from '../settings/pay-account';
import { bankLabel } from '../common/vietqr';
import { PAY_KEY, cleanRequests, newPayCode, payQrImageUrl, payText, readClaim, suggestedDeposit, type PayRequest } from './chat-pay';

/**
 * Mã QR đặt cọc gửi trong cuộc chat — one salon at a time. The bank account
 * is the salon's own (POS settings), the thread is looked up inside the
 * caller's salon, and the request list lives in that salon's settings row.
 */
@Injectable()
export class ChatPayService {
  private readonly logger = new Logger(ChatPayService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly settings?: SettingsService) {}

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  async requestsOf(tenantId: string): Promise<PayRequest[]> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PAY_KEY } } }).catch(() => null);
    return cleanRequests(row?.value);
  }

  private async save(tenantId: string, list: PayRequest[]) {
    const value = cleanRequests(list) as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({ where: { tenantId_key: { tenantId, key: PAY_KEY } }, create: { tenantId, key: PAY_KEY, value }, update: { value } });
  }

  private async audit(tenantId: string, userId: string | null, action: string, resourceId: string, meta: Record<string, unknown>) {
    try { await this.prisma.auditLog.create({ data: { tenantId, userId: userId ?? undefined, action, resourceType: 'messenger', resourceId, metadata: meta as Prisma.InputJsonValue } as never }); } catch { /* never break */ }
  }

  /** The salon's VietQR account, or null (not set, or not a VN salon). */
  async bankOf(tenantId: string): Promise<{ bin: string; accountNo: string; accountName: string } | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } }).catch(() => null);
    if (String(t?.market ?? '').toUpperCase() !== 'VN' || !this.settings) return null;
    const [pos, legacy] = await Promise.all([
      this.settings.getPosSettings(tenantId).catch(() => null),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: RESTAURANT_SETTINGS_KEY } } }).catch(() => null),
    ]);
    return resolvePayAccount(pos as never, (legacy?.value as { bank?: unknown } | null)?.bank).bank;
  }

  /**
   * What the "QR đặt cọc" panel needs for one conversation: whether the salon
   * can send one, the customer's next booking and the deposit the salon's rule
   * suggests for it, and this conversation's requests so far.
   */
  async panel(user: AuthenticatedUser, threadId: string) {
    const tenantId = this.tenantOf(user);
    const thread = await this.prisma.messengerThread.findFirst({ where: { id: String(threadId ?? ''), tenantId }, select: { id: true, customerId: true } as never }) as { id: string; customerId?: string | null } | null;
    if (!thread) throw new NotFoundException('Thread not found');
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { market: true } }).catch(() => null);
    if (String(t?.market ?? '').toUpperCase() !== 'VN') return { available: false, reason: 'not_vn', bank: null, appointment: null, suggestedCents: null, requests: [] };
    const bank = await this.bankOf(tenantId);
    const appt = thread.customerId ? await this.prisma.appointment.findFirst({
      where: { tenantId, customerId: thread.customerId, startTime: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED'] as never } },
      orderBy: { startTime: 'asc' }, select: { id: true, startTime: true, priceCents: true, service: { select: { name: true } } },
    }).catch(() => null) : null;
    const dep = this.settings ? await this.settings.getDepositSettings(tenantId).catch(() => null) : null;
    const requests = (await this.requestsOf(tenantId)).filter((r) => r.threadId === thread.id).slice(0, 5);
    return {
      available: !!bank,
      reason: bank ? null : 'no_bank',
      bank: bank ? { name: bankLabel(bank.bin), accountNo: `•••${bank.accountNo.slice(-4)}`, accountName: bank.accountName } : null,
      appointment: appt ? { id: appt.id, startTime: appt.startTime.toISOString(), service: appt.service?.name ?? null, priceCents: appt.priceCents } : null,
      suggestedCents: appt ? suggestedDeposit(dep as never, appt.priceCents) : (dep && (dep as { type?: string }).type === 'fixed' ? suggestedDeposit(dep as never, 0) : null),
      requests,
    };
  }

  /**
   * A person sends the QR. Returns the picture address and the text for the
   * caller (the controller) to send through the Inbox's own photo and text
   * routes — same window, ownership and audit rules as anything typed.
   */
  async prepare(user: AuthenticatedUser, threadId: string, body: { amountCents?: unknown; appointmentId?: unknown }) {
    const tenantId = this.tenantOf(user);
    const thread = await this.prisma.messengerThread.findFirst({ where: { id: String(threadId ?? ''), tenantId }, select: { id: true } });
    if (!thread) throw new NotFoundException('Thread not found');
    const bank = await this.bankOf(tenantId);
    if (!bank) throw new BadRequestException('Chưa có tài khoản ngân hàng nhận tiền — chủ tiệm điền ở Cài đặt › Thu ngân (POS).');
    const amount = Math.round(Number(body?.amountCents ?? 0));
    if (!(amount >= 1000 && amount <= 100_000_000)) throw new BadRequestException('Số tiền cọc phải từ 1.000đ đến 100.000.000đ.');
    let appointmentId: string | null = null;
    if (typeof body?.appointmentId === 'string' && body.appointmentId) {
      const a = await this.prisma.appointment.findFirst({ where: { id: body.appointmentId, tenantId }, select: { id: true } }).catch(() => null);
      if (!a) throw new BadRequestException('Lịch hẹn không thuộc tiệm này.');
      appointmentId = a.id;
    }
    const list = await this.requestsOf(tenantId);
    const code = newPayCode(new Set(list.map((r) => r.code)));
    return {
      tenantId, code, amount, appointmentId,
      url: payQrImageUrl(bank, amount, code),
      text: payText(amount, code, bankLabel(bank.bin), bank.accountNo, bank.accountName),
    };
  }

  /** Recorded once the QR really went out. */
  async recordSent(user: AuthenticatedUser, tenantId: string, threadId: string, p: { code: string; amount: number; appointmentId: string | null }, by: string | null) {
    const list = await this.requestsOf(tenantId);
    list.unshift({ code: p.code, threadId, appointmentId: p.appointmentId, amountCents: p.amount, at: new Date().toISOString(), by, status: 'sent', claim: null, bank: null });
    await this.save(tenantId, list);
    await this.audit(tenantId, user.userId ?? null, 'messenger.pay_qr_sent', threadId, { code: p.code, amountCents: p.amount, appointmentId: p.appointmentId });
  }

  /**
   * The customer sent pictures. Only when this conversation has an open QR
   * request is a picture read (it costs a model call), and then only to note
   * "khách báo đã chuyển X" beside the request — a person and the bank decide.
   */
  async onCustomerImages(tenantId: string, threadId: string, urls: string[], read: (urls: string[]) => Promise<string | null>): Promise<void> {
    if (!urls.length) return;
    const list = await this.requestsOf(tenantId);
    const open = list.find((r) => r.threadId === threadId && (r.status === 'sent' || r.status === 'claimed'));
    if (!open) return;
    const note = await read(urls).catch(() => null);
    if (!note) return;
    const c = readClaim(open, note);
    if (c.amountCents == null && !c.codeSeen) return;
    const fresh = await this.requestsOf(tenantId);
    const next = fresh.map((r) => (r.code === open.code ? { ...r, status: r.status === 'sent' ? 'claimed' as const : r.status, claim: { ...c, at: new Date().toISOString() } } : r));
    await this.save(tenantId, next);
    await this.audit(tenantId, null, 'messenger.pay_claim_photo', threadId, { code: open.code, amountCents: c.amountCents, codeSeen: c.codeSeen });
  }
}
