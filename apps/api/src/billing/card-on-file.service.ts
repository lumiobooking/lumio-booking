import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { PaypalService } from './paypal.service';
import { StripeService } from './stripe.service';
import { PlatformConfigService } from './platform-config.service';
import { gatewayOf, type Gateway } from './gateway-choice';
import { cardLabel, cardMetaFromPaypal, cardMetaFromStripe, declineText, gatewayForNewCard, type SavedCard } from './card-on-file';
import { emitBillingEvent } from './billing-events';

/**
 * THE SALON'S CARD ON FILE — entered in Lumio's own page, held by the gateway.
 *
 * The card number never reaches this server: PayPal's Card Fields or Stripe's
 * Payment Element collect it in the browser and hand back a token. What is
 * stored here is that token, which gateway it belongs to, and the brand /
 * last four / expiry a receipt prints (billing/card-on-file.ts).
 *
 * Every read and write is scoped to the signed-in salon's tenantId; a token
 * is only ever charged for the tenant that saved it.
 */

type PmRow = {
  id: string; tenantId: string; provider: string; token: string; externalCustomerId: string | null;
  brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null;
  status: string; lastChargeAt: Date | null; lastError: string | null;
};

@Injectable()
export class CardOnFileService {
  private readonly log = new Logger(CardOnFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly stripe: StripeService,
    private readonly platform: PlatformConfigService,
    private readonly audit: AuditService,
  ) {}

  private get pm() {
    return (this.prisma as unknown as { billingCard: {
      findFirst: (a: unknown) => Promise<PmRow | null>;
      create: (a: unknown) => Promise<PmRow>;
      update: (a: unknown) => Promise<PmRow>;
      updateMany: (a: unknown) => Promise<{ count: number }>;
    } }).billingCard;
  }

  /** The salon's active card, if any. */
  async current(tenantId: string): Promise<PmRow | null> {
    return this.pm.findFirst({ where: { tenantId, status: { in: ['active', 'failed'] } }, orderBy: { createdAt: 'desc' } }).catch(() => null);
  }

  private toSaved(r: PmRow | null): SavedCard | null {
    if (!r) return null;
    const provider = gatewayOf(r.provider);
    if (!provider) return null;
    return {
      id: r.id, provider, status: (r.status as SavedCard['status']) ?? 'active',
      brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear,
      lastChargeAt: r.lastChargeAt?.toISOString() ?? null, lastError: r.lastError,
    };
  }

  /** Which gateways can show an in-page card form right now. */
  async formGateways() {
    const [stripeOn, paypalOn, stripePub, paypalClient] = await Promise.all([
      this.stripe.isEnabled().catch(() => false), this.paypal.isEnabled().catch(() => false),
      this.platform.get('stripe_publishable_key'), this.platform.get('paypal_client_id'),
    ]);
    return { stripe: stripeOn, paypal: paypalOn, stripePublic: !!stripePub, paypalClient: !!paypalClient };
  }

  /** What the billing screen shows: the card, its label, and which form it can open. */
  async view(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const [row, gw] = await Promise.all([this.current(tenantId), this.formGateways()]);
    const card = this.toSaved(row);
    return {
      card,
      label: card ? cardLabel(card) : null,
      lastErrorText: card?.lastError ? declineText(card.lastError, true) : null,
      /** The gateway a new card would go to, or null when no in-page form is possible. */
      formGateway: gatewayForNewCard(gw),
      gateways: { stripe: gw.stripe && gw.stripePublic, paypal: gw.paypal && gw.paypalClient },
    };
  }

  /**
   * Open a card form: what the browser needs to render the gateway's fields.
   * PayPal: a vault setup token + the public client id. Stripe: a SetupIntent
   * client secret + the publishable key. Nothing here is a secret.
   */
  async start(user: AuthenticatedUser, asked?: string | null) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const gw = await this.formGateways();
    const provider = gatewayForNewCard(gw, asked === 'stripe' || asked === 'paypal' ? asked : null);
    if (!provider) throw new BadRequestException('Chưa có cổng thanh toán nào nhận thẻ. Liên hệ Lumio.');
    if (provider === 'paypal') {
      let setup: { id: string };
      try {
        setup = await this.paypal.createSetupToken();
      } catch (e) {
        const m = (e as Error).message ?? '';
        // "Authorization failed due to insufficient permissions" = the REST app
        // has no Vault / Advanced Card features yet. Said in the owner's words.
        if (/insufficient permissions|NOT_AUTHORIZED|PERMISSION_DENIED/i.test(m)) {
          throw new BadRequestException('PayPal chưa cho phép lưu thẻ trong trang: app PayPal cần bật "Advanced Credit and Debit Card Payments" và "Vault" (developer.paypal.com → app → Features). Trong lúc chờ, dùng nút gói bên dưới để thanh toán qua trang PayPal.');
        }
        throw e;
      }
      return { provider, paypal: { clientId: await this.platform.get('paypal_client_id'), env: (await this.platform.get('paypal_env')) ?? 'live', setupToken: setup.id } };
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, contactEmail: true } });
    const existing = await this.current(tenantId);
    const customerId = existing?.provider === 'stripe' && existing.externalCustomerId
      ? existing.externalCustomerId
      : await this.stripe.ensureCustomer({ email: tenant?.contactEmail ?? user.email ?? undefined, name: tenant?.name ?? undefined, tenantId });
    const si = await this.stripe.createSetupIntent(customerId);
    return { provider, stripe: { publishableKey: await this.platform.get('stripe_publishable_key'), clientSecret: si.clientSecret, customerId } };
  }

  /**
   * The browser is back with the gateway's token: turn it into the saved
   * card, retire the previous one, and tell the rest of billing a card now
   * exists (invoices.service charges what is due).
   */
  async confirm(user: AuthenticatedUser, dto: { provider?: string; setupToken?: string; setupIntentId?: string }) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const provider = gatewayOf(dto.provider);
    if (!provider) throw new BadRequestException('provider phải là paypal | stripe');
    let token: string; let customerId: string | null = null; let meta;
    if (provider === 'paypal') {
      if (!dto.setupToken) throw new BadRequestException('Thiếu setupToken');
      const pt = await this.paypal.createPaymentToken(dto.setupToken);
      token = pt.id; customerId = pt.customerId; meta = cardMetaFromPaypal(pt.raw);
    } else {
      if (!dto.setupIntentId) throw new BadRequestException('Thiếu setupIntentId');
      const r = await this.stripe.confirmSetupIntent(dto.setupIntentId);
      token = r.paymentMethodId; customerId = r.customerId; meta = cardMetaFromStripe(r.paymentMethod);
    }
    // One card per salon: the previous row is retired (and released at its
    // gateway, best-effort) so a replaced card can never be charged again.
    const prev = await this.current(tenantId);
    if (prev && prev.token !== token) {
      await this.pm.updateMany({ where: { tenantId, status: { in: ['active', 'failed'] } }, data: { status: 'removed' } }).catch(() => undefined);
      void this.release(prev).catch(() => undefined);
    }
    const row = prev && prev.token === token
      ? await this.pm.update({ where: { id: prev.id }, data: { status: 'active', lastError: null, ...meta } })
      : await this.pm.create({ data: { tenantId, provider, token, externalCustomerId: customerId, status: 'active', ...meta } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'billing.card_saved', resourceType: 'payment_method', resourceId: row.id, metadata: { provider, brand: meta.brand, last4: meta.last4 } });
    this.log.log(`Card saved for ${tenantId}: ${provider} ${cardLabel(meta)}`);
    emitBillingEvent('card_added', tenantId);
    return this.view(user);
  }

  /** Remove the card: retired here, released at the gateway. Billing falls back to invoices by email. */
  async remove(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const row = await this.current(tenantId);
    if (!row) throw new NotFoundException('Chưa có thẻ nào.');
    await this.pm.update({ where: { id: row.id }, data: { status: 'removed' } });
    void this.release(row).catch(() => undefined);
    await this.audit.log({ tenantId, userId: user.userId, action: 'billing.card_removed', resourceType: 'payment_method', resourceId: row.id, metadata: { provider: row.provider, last4: row.last4 } });
    return this.view(user);
  }

  private async release(row: PmRow): Promise<void> {
    if (row.provider === 'paypal') await this.paypal.deletePaymentToken(row.token);
    else if (row.provider === 'stripe') await this.stripe.detachPaymentMethod(row.token);
  }

  /**
   * Charge the saved card. The one method the invoices use; returns the
   * gateway's reference, or throws with the decline in the gateway's words
   * (recorded on the row so the screen can say why).
   */
  async charge(tenantId: string, p: { amountCents: number; currency: string; description: string; invoiceId: string }): Promise<{ provider: Gateway; ref: string } | null> {
    const row = await this.current(tenantId);
    if (!row || row.status === 'removed') return null;
    const provider = gatewayOf(row.provider);
    if (!provider) return null;
    try {
      const ref = provider === 'paypal'
        ? (await this.paypal.chargeVault({ vaultId: row.token, amountCents: p.amountCents, currency: p.currency, description: p.description, invoiceId: p.invoiceId })).captureId
        : (await this.stripe.chargePaymentMethod({ customerId: row.externalCustomerId!, paymentMethodId: row.token, amountCents: p.amountCents, currency: p.currency, description: p.description, metadata: { invoiceId: p.invoiceId, tenantId } })).paymentIntentId;
      await this.pm.update({ where: { id: row.id }, data: { status: 'active', lastChargeAt: new Date(), lastError: null } }).catch(() => undefined);
      return { provider, ref };
    } catch (e) {
      const msg = (e as Error).message ?? 'declined';
      await this.pm.update({ where: { id: row.id }, data: { status: 'failed', lastError: msg.slice(0, 300) } }).catch(() => undefined);
      throw e;
    }
  }
}
