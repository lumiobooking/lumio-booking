import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, NotificationChannel, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceService } from '../voice/voice.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StripeService } from '../billing/stripe.service';
import { publicWebBase } from '../common/public-url.util';

interface LineItem { label: string; amountCents: number }

const money = (c: number, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((c || 0) / 100);

/**
 * Month-end usage-overage invoices and plan-renewal invoices. Each invoice is a
 * DB record with a public token (hosted /invoice/<token> page) and is emailed to
 * the salon owner from Lumio's platform email with a Stripe payment link.
 * Invoices are idempotent per (tenant, type, period) so the scheduler can run
 * repeatedly without ever double-billing.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger('InvoicesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly voice: VoiceService,
    private readonly notifications: NotificationsService,
    private readonly stripe: StripeService,
  ) {}

  // -------------------------------------------------------------- helpers
  private async ownerEmail(tenantId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { tenantId, role: UserRole.SALON_ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    return u?.email ?? null;
  }

  private async nextNumber(now: Date): Promise<string> {
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.invoice.count({ where: { number: { startsWith: `INV-${ym}-` } } });
    return `INV-${ym}-${String(count + 1).padStart(4, '0')}`;
  }

  private monthStart(d = new Date()): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
  private prevMonthStart(d = new Date()): Date { return new Date(d.getFullYear(), d.getMonth() - 1, 1); }

  // -------------------------------------------------------------- generation
  /** Build (idempotent) the usage-overage invoice for a completed month. Returns
   *  the invoice, or null when there is no overage to bill. */
  async buildOverageInvoice(tenantId: string, monthStart: Date): Promise<{ id: string } | null> {
    const existing = await this.prisma.invoice.findFirst({ where: { tenantId, type: InvoiceType.OVERAGE, periodStart: monthStart }, select: { id: true } });
    if (existing) return existing;

    const u = await this.voice.usageForMonth(tenantId, monthStart);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: { select: { currency: true, maxSmsPerMonth: true } } } });
    const cur = tenant?.plan?.currency ?? 'USD';

    // SMS allowance reconciled with the plan (per-tenant override wins).
    const smsIncluded = u.includedSms > 0 ? u.includedSms : (tenant?.plan?.maxSmsPerMonth ?? 0);
    const smsOver = smsIncluded > 0 ? Math.max(0, u.smsSent - smsIncluded) : 0;
    const smsCents = smsOver * u.overageCentsPerSms;
    const minCents = u.overageMinutes * u.overageCentsPerMin;
    const total = smsCents + minCents;
    if (total <= 0) return null;

    const lineItems: LineItem[] = [];
    if (minCents > 0) lineItems.push({ label: `AI Hotline minutes over plan — ${u.overageMinutes} × ${money(u.overageCentsPerMin, cur)}`, amountCents: minCents });
    if (smsCents > 0) lineItems.push({ label: `SMS over plan — ${smsOver} × ${money(u.overageCentsPerSms, cur)}`, amountCents: smsCents });

    const periodEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const due = new Date(); due.setDate(due.getDate() + 14);
    try {
      const inv = await this.prisma.invoice.create({
        data: {
          tenantId, number: await this.nextNumber(new Date()), type: InvoiceType.OVERAGE, currency: cur,
          periodStart: monthStart, periodEnd, lineItems: lineItems as unknown as object,
          subtotalCents: total, totalCents: total, dueDate: due,
        },
        select: { id: true },
      });
      return inv;
    } catch {
      return this.prisma.invoice.findFirst({ where: { tenantId, type: InvoiceType.OVERAGE, periodStart: monthStart }, select: { id: true } });
    }
  }

  /** Build (idempotent) a plan-renewal invoice for a billing period. */
  async buildRenewalInvoice(tenantId: string, periodStart: Date): Promise<{ id: string } | null> {
    const existing = await this.prisma.invoice.findFirst({ where: { tenantId, type: InvoiceType.RENEWAL, periodStart }, select: { id: true } });
    if (existing) return existing;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: { select: { name: true, currency: true, priceMonthlyCents: true, priceCents: true } } } });
    const plan = tenant?.plan;
    const amount = (plan?.priceMonthlyCents || plan?.priceCents) ?? 0;
    if (!plan || amount <= 0) return null;
    const cur = plan.currency ?? 'USD';
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate());
    const due = new Date(); due.setDate(due.getDate() + 7);
    const lineItems: LineItem[] = [{ label: `${plan.name ?? 'Plan'} — monthly renewal`, amountCents: amount }];
    try {
      const inv = await this.prisma.invoice.create({
        data: {
          tenantId, number: await this.nextNumber(new Date()), type: InvoiceType.RENEWAL, currency: cur,
          periodStart, periodEnd, lineItems: lineItems as unknown as object,
          subtotalCents: amount, totalCents: amount, dueDate: due,
        },
        select: { id: true },
      });
      return inv;
    } catch {
      return this.prisma.invoice.findFirst({ where: { tenantId, type: InvoiceType.RENEWAL, periodStart }, select: { id: true } });
    }
  }

  // -------------------------------------------------------------- email
  async sendInvoiceEmail(invoiceId: string, force = false): Promise<boolean> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { tenant: { select: { name: true } } } });
    if (!inv) return false;
    if (inv.sentAt && !force) return false; // already emailed — don't re-send on daily ticks
    const email = await this.ownerEmail(inv.tenantId);
    if (!email) { this.logger.warn(`Invoice ${inv.number}: no owner email; not sent`); return false; }

    const link = `${publicWebBase()}/invoice/${inv.token}`;
    const cur = inv.currency;
    const items = (inv.lineItems as unknown as LineItem[]) || [];
    const rows = items.map((li) => `<tr><td style="padding:6px 0;color:#334155">${li.label}</td><td align="right" style="padding:6px 0;color:#0f172a;font-weight:600">${money(li.amountCents, cur)}</td></tr>`).join('');
    const isRenewal = inv.type === InvoiceType.RENEWAL;
    const title = isRenewal ? 'Plan renewal' : 'Usage charges';
    const subject = isRenewal
      ? `Lumio — renew your plan (${money(inv.totalCents, cur)})`
      : `Lumio invoice ${inv.number} — ${money(inv.totalCents, cur)}`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <div style="font-size:20px;font-weight:800;color:#4f46e5">Lumio Booking</div>
        <h2 style="font-size:18px;margin:14px 0 2px">${title} · ${inv.tenant?.name ?? ''}</h2>
        <div style="color:#64748b;font-size:13px;margin-bottom:14px">Invoice ${inv.number}</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
          <tr><td style="padding:10px 0 0;border-top:1px solid #e2e8f0;font-weight:800">Total due</td>
              <td align="right" style="padding:10px 0 0;border-top:1px solid #e2e8f0;font-weight:800;font-size:16px">${money(inv.totalCents, cur)}</td></tr>
        </table>
        <div style="margin:22px 0">
          <a href="${link}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">View &amp; pay invoice →</a>
        </div>
        <div style="color:#94a3b8;font-size:12px">Or open: ${link}</div>
        <div style="color:#94a3b8;font-size:12px;margin-top:14px">Questions about this bill? Just reply to this email.</div>
      </div>`;
    const body = `Lumio ${title} — ${inv.tenant?.name ?? ''}\nInvoice ${inv.number}\nTotal due: ${money(inv.totalCents, cur)}\nView & pay: ${link}`;

    await this.notifications.send({
      tenantId: inv.tenantId, channel: NotificationChannel.EMAIL, recipient: email,
      subject, body, html, senderName: 'Lumio Booking', relatedType: 'invoice', relatedId: inv.id,
    });
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { sentAt: new Date() } });
    return true;
  }

  /** Create + email an invoice in one step (used by the scheduler / super admin). */
  async issue(invoiceId: string | null): Promise<void> {
    if (invoiceId) await this.sendInvoiceEmail(invoiceId);
  }

  // -------------------------------------------------------------- public page + pay
  async getPublic(token: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { token }, include: { tenant: { select: { name: true } } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return {
      number: inv.number, type: inv.type, status: inv.status, currency: inv.currency,
      subtotalCents: inv.subtotalCents, totalCents: inv.totalCents,
      lineItems: (inv.lineItems as unknown as LineItem[]) || [],
      periodStart: inv.periodStart, periodEnd: inv.periodEnd, dueDate: inv.dueDate,
      createdAt: inv.createdAt, paidAt: inv.paidAt, salonName: inv.tenant?.name ?? null,
      canPay: inv.status === InvoiceStatus.OPEN && (await this.stripe.isEnabled()),
    };
  }

  async startCheckout(token: string): Promise<{ url: string }> {
    const inv = await this.prisma.invoice.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.PAID) throw new BadRequestException('This invoice is already paid');
    if (inv.status === InvoiceStatus.VOID) throw new BadRequestException('This invoice was cancelled');
    if (!(await this.stripe.isEnabled())) throw new BadRequestException('Online payment is not available. Please contact Lumio.');
    const email = (await this.ownerEmail(inv.tenantId)) ?? undefined;
    const base = publicWebBase();
    return this.stripe.createPaymentSession({
      amountCents: inv.totalCents, currency: inv.currency,
      productName: inv.type === InvoiceType.RENEWAL ? `Lumio plan renewal (${inv.number})` : `Lumio invoice ${inv.number}`,
      customerEmail: email,
      successUrl: `${base}/invoice/${inv.token}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/invoice/${inv.token}`,
      metadata: { invoiceId: inv.id, tenantId: inv.tenantId, kind: inv.type === InvoiceType.RENEWAL ? 'invoice_renewal' : 'invoice_overage' },
    });
  }

  /** Confirm payment when the payer returns from Stripe (success_url). */
  async confirm(token: string, sessionId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.PAID) return { status: 'PAID' };
    let paid = false;
    try {
      const s = await this.stripe.getCheckoutSession(sessionId);
      paid = s.paymentStatus === 'paid' && s.metadata?.invoiceId === inv.id;
    } catch { paid = false; }
    if (!paid) return { status: inv.status };
    await this.markPaid(inv.id, 'stripe', sessionId);
    return { status: 'PAID' };
  }

  /** Mark an invoice paid and, for a renewal, extend the salon's access by a month. */
  async markPaid(invoiceId: string, provider: string, ref?: string): Promise<void> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, tenantId: true, type: true, status: true } });
    if (!inv || inv.status === InvoiceStatus.PAID) return;
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.PAID, paidAt: new Date(), provider, externalRef: ref ?? null } });
    if (inv.type === InvoiceType.RENEWAL) {
      const t = await this.prisma.tenant.findUnique({ where: { id: inv.tenantId }, select: { accessUntil: true } });
      const from = t?.accessUntil && t.accessUntil > new Date() ? t.accessUntil : new Date();
      const next = new Date(from); next.setMonth(next.getMonth() + 1);
      await this.prisma.tenant.update({ where: { id: inv.tenantId }, data: { accessUntil: next, status: TenantStatus.ACTIVE } });
    }
  }

  // -------------------------------------------------------------- listings
  async listForTenant(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 60,
      select: { id: true, number: true, type: true, status: true, totalCents: true, currency: true, periodStart: true, periodEnd: true, dueDate: true, token: true, createdAt: true },
    });
  }

  async adminList(limit = 200) {
    const rows = await this.prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' }, take: limit,
      select: { id: true, number: true, type: true, status: true, totalCents: true, currency: true, sentAt: true, paidAt: true, token: true, createdAt: true, tenant: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...r, salonName: r.tenant?.name ?? null, tenant: undefined }));
  }

  async voidInvoice(id: string) {
    await this.prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.OPEN }, data: { status: InvoiceStatus.VOID } });
    return { ok: true };
  }
}
