import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../auth/password.util';
import { uniqueSlug } from '../tenants/slug.util';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { StripeService } from './stripe.service';
import { PaypalService } from './paypal.service';
import { PlatformConfigService } from './platform-config.service';
import { VoiceService } from '../voice/voice.service';

export interface SignupInput {
  salonName: string;
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  planId: string;
  interval: 'month' | 'year';
  provider: 'stripe' | 'paypal';
  timezone?: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger('BillingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
    private readonly platform: PlatformConfigService,
    private readonly voice: VoiceService,
  ) {}

  /** Super Admin: gateway connection status + webhook URLs for the UI. */
  async gatewayStatus() {
    const [stripeKey, stripeHook, ppId, ppSecret, ppHook, ppEnv] = await Promise.all([
      this.platform.get('stripe_secret_key'), this.platform.get('stripe_webhook_secret'),
      this.platform.get('paypal_client_id'), this.platform.get('paypal_secret'),
      this.platform.get('paypal_webhook_id'), this.platform.get('paypal_env'),
    ]);
    const apiBase = (this.config.get<string>('RENDER_EXTERNAL_URL') ?? this.config.get<string>('KEEPALIVE_SELF_URL') ?? '').replace(/\/$/, '');
    return {
      stripe: { hasKey: !!stripeKey, hasWebhook: !!stripeHook, live: (stripeKey ?? '').startsWith('sk_live') },
      paypal: { hasClient: !!(ppId && ppSecret), hasWebhook: !!ppHook, env: ppEnv ?? 'live' },
      webhookStripeUrl: apiBase ? `${apiBase}/api/billing/webhook/stripe` : '/api/billing/webhook/stripe',
      webhookPaypalUrl: apiBase ? `${apiBase}/api/billing/webhook/paypal` : '/api/billing/webhook/paypal',
    };
  }

  /** Active plans a logged-in salon can upgrade to (regardless of publicVisible). */
  async upgradePlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
      select: { id: true, name: true, tagline: true, currency: true, priceMonthlyCents: true, priceYearlyCents: true, priceCents: true, featuresJson: true, highlighted: true },
    });
    const [stripeOn, paypalOn] = await Promise.all([this.stripe.isEnabled(), this.paypal.isEnabled()]);
    return plans.map((p) => ({
      id: p.id, name: p.name, tagline: p.tagline, currency: p.currency,
      // Fall back to the legacy priceCents so plans priced before the monthly/
      // yearly fields existed still show a price (instead of $0).
      priceMonthlyCents: p.priceMonthlyCents || p.priceCents,
      priceYearlyCents: p.priceYearlyCents,
      highlighted: p.highlighted,
      features: Array.isArray(p.featuresJson) ? (p.featuresJson as string[]) : [],
      providers: { stripe: stripeOn, paypal: paypalOn },
    }));
  }

  /** Full billing summary for the salon: plan, dates, and manual-access info. */
  async subscriptionStatus(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const [tenant, subscription] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true, billingExempt: true, accessUntil: true, plan: { select: { name: true } } },
      }),
      this.prisma.subscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, provider: true, interval: true, currentPeriodStart: true, currentPeriodEnd: true, trialEndsAt: true, createdAt: true },
      }),
    ]);
    return {
      planName: tenant?.plan?.name ?? null,
      tenantStatus: tenant?.status ?? null,
      billingExempt: tenant?.billingExempt ?? false,
      accessUntil: tenant?.accessUntil ?? null,
      subscription, // null when the salon has never paid (manual/free access)
    };
  }

  /**
   * Itemized month-to-date bill so the salon owner always knows exactly what they
   * will pay: fixed fees (plan + AI Hotline add-on) + variable overage (SMS beyond
   * the plan allowance + AI Hotline minutes beyond the included bucket) + a
   * projected month-end total. Always available — never hidden by feature policy.
   */
  async usageSummary(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const [tenant, line, u] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { plan: { select: { name: true, currency: true, priceMonthlyCents: true, priceCents: true, maxSmsPerMonth: true } } },
      }),
      this.prisma.voiceLine.findUnique({ where: { tenantId }, select: { enabled: true, monthlyCents: true } }),
      this.voice.usage(user),
    ]);
    const plan = tenant?.plan ?? null;
    const currency = plan?.currency ?? 'USD';
    const baseCents = (plan?.priceMonthlyCents || plan?.priceCents) ?? 0;

    // ---- AI Hotline (voice) ----
    const hotlineEnabled = !!line?.enabled;
    const hotlineMonthlyCents = hotlineEnabled ? (line?.monthlyCents ?? 0) : 0;
    const minIncluded = u.includedMinutes;
    const minUsed = u.aiMinutes;
    const minOver = u.overageMinutes; // 0 when no included bucket is set (bundled/unlimited)
    const minRate = u.overageCentsPerMin;
    const minOverageCents = minOver * minRate;

    // ---- SMS (reconciled with the plan allowance) ----
    // A per-tenant override (VoiceLine.includedSms) wins; otherwise the plan's monthly SMS.
    const smsIncluded = u.includedSms > 0 ? u.includedSms : (plan?.maxSmsPerMonth ?? 0);
    const smsUsed = u.smsSent;
    const smsOver = smsIncluded > 0 ? Math.max(0, smsUsed - smsIncluded) : 0;
    const smsRate = u.overageCentsPerSms;
    const smsOverageCents = smsOver * smsRate;

    // ---- Totals ----
    const fixedCents = baseCents + hotlineMonthlyCents;
    const overageCents = minOverageCents + smsOverageCents;
    const grandTotalCents = fixedCents + overageCents;

    // Straight-line projection of the variable overage to month end.
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = Math.max(1, now.getDate());
    const projectedOverageCents = Math.round((overageCents / dayOfMonth) * daysInMonth);
    const projectedGrandTotalCents = fixedCents + projectedOverageCents;

    return {
      periodStart: u.periodStart,
      currency,
      daysElapsed: dayOfMonth,
      daysInMonth,
      plan: { name: plan?.name ?? null, monthlyCents: baseCents },
      hotline: {
        enabled: hotlineEnabled,
        monthlyCents: hotlineMonthlyCents,
        includedMinutes: minIncluded,
        usedMinutes: minUsed,
        overageMinutes: minOver,
        overageCentsPerMin: minRate,
        overageCents: minOverageCents,
        aiCalls: u.aiCalls,
      },
      sms: {
        included: smsIncluded,
        used: smsUsed,
        overage: smsOver,
        overageCentsPer: smsRate,
        overageCents: smsOverageCents,
      },
      totals: { fixedCents, overageCents, grandTotalCents, projectedGrandTotalCents },
    };
  }

  /** Super Admin: actually call Stripe/PayPal to confirm the keys work. */
  async testGateways() {
    const result: { stripe: string; paypal: string } = { stripe: 'not configured', paypal: 'not configured' };
    if (await this.stripe.isEnabled()) {
      try { await this.stripe.ping(); result.stripe = 'ok'; } catch (e) { result.stripe = e instanceof Error ? e.message : 'failed'; }
    }
    if (await this.paypal.isEnabled()) {
      try { await this.paypal.ping(); result.paypal = 'ok'; } catch (e) { result.paypal = e instanceof Error ? e.message : 'failed'; }
    }
    return result;
  }

  /** Super Admin: save gateway keys (blank fields are left unchanged). */
  async saveGateways(dto: Record<string, string | undefined>) {
    await this.platform.setMany({
      stripe_secret_key: dto.stripeSecretKey,
      stripe_webhook_secret: dto.stripeWebhookSecret,
      paypal_client_id: dto.paypalClientId,
      paypal_secret: dto.paypalSecret,
      paypal_webhook_id: dto.paypalWebhookId,
      paypal_env: dto.paypalEnv,
      app_url: dto.appUrl,
    });
    return this.gatewayStatus();
  }

  private appUrl(): string {
    return (this.config.get<string>('APP_URL') ?? 'https://lumiobooking.com').replace(/\/$/, '');
  }

  /** Public: plans shown on the marketing/pricing page. */
  async publicPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { publicVisible: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
      select: {
        id: true, name: true, tagline: true, description: true, currency: true,
        priceMonthlyCents: true, priceYearlyCents: true, priceCents: true, trialDays: true,
        featuresJson: true, highlighted: true,
        maxStaff: true, maxBookingsPerMonth: true, posEnabled: true,
        onlinePaymentEnabled: true, multiLocationEnabled: true,
      },
    });
    // A provider is usable whenever its keys are configured (no per-plan IDs).
    const [stripeOn, paypalOn] = await Promise.all([this.stripe.isEnabled(), this.paypal.isEnabled()]);
    return plans.map((p) => ({
      ...p,
      priceMonthlyCents: p.priceMonthlyCents || p.priceCents, // fall back to legacy price
      priceCents: undefined,
      features: Array.isArray(p.featuresJson) ? (p.featuresJson as string[]) : [],
      featuresJson: undefined,
      providers: { stripe: stripeOn, paypal: paypalOn },
    }));
  }

  /**
   * Self-serve signup: create a PENDING tenant + its SALON_ADMIN user, then
   * hand back the provider checkout URL. The tenant is only ACTIVATED by the
   * payment webhook — so an abandoned checkout never yields a usable account.
   */
  async signup(dto: SignupInput): Promise<{ checkoutUrl: string; tenantId: string }> {
    const email = dto.email.trim().toLowerCase();
    if (!email || !dto.password || dto.password.length < 8) {
      throw new BadRequestException('A valid email and a password of at least 8 characters are required');
    }
    if (!dto.salonName?.trim()) throw new BadRequestException('Salon name is required');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('An account with this email already exists. Please sign in instead.');

    const plan = await this.prisma.plan.findFirst({ where: { id: dto.planId, publicVisible: true, isActive: true } });
    if (!plan) throw new BadRequestException('Plan not found');

    const interval: BillingInterval = dto.interval === 'year' ? BillingInterval.YEARLY : BillingInterval.MONTHLY;

    // Build a unique slug for the salon.
    const taken = await this.prisma.tenant.findMany({ select: { slug: true } });
    const slug = uniqueSlug(dto.salonName, new Set(taken.map((t) => t.slug)));

    // Create tenant (PENDING) + admin user in one transaction.
    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: dto.salonName.trim(),
          slug,
          status: TenantStatus.PENDING,
          planId: plan.id,
          subscriptionStatus: SubscriptionStatus.TRIALING,
          contactEmail: email,
          ...(dto.timezone ? { timezone: dto.timezone } : {}),
        },
      });
      await tx.user.create({
        data: {
          tenantId: t.id,
          role: 'SALON_ADMIN',
          email,
          passwordHash: await hashSecret(dto.password),
          firstName: dto.firstName?.trim() || null,
          lastName: dto.lastName?.trim() || null,
        },
      });
      return t;
    });

    await this.audit.log({ tenantId: tenant.id, userId: null, action: 'tenant.signup', resourceType: 'tenant', resourceId: tenant.id, metadata: { planId: plan.id, interval, provider: dto.provider } });

    const success = `${this.appUrl()}/welcome?provider=${dto.provider}`;
    const cancel = `${this.appUrl()}/signup?plan=${plan.id}&interval=${dto.interval}&canceled=1`;
    const meta = { tenantId: tenant.id, planId: plan.id, interval };
    const isYearly = interval === BillingInterval.YEARLY;
    const amountCents = isYearly ? plan.priceYearlyCents : (plan.priceMonthlyCents || plan.priceCents);
    if (!amountCents || amountCents <= 0) throw new BadRequestException(`This plan has no ${isYearly ? 'yearly' : 'monthly'} price set`);

    if (dto.provider === 'paypal') {
      if (!(await this.paypal.isEnabled())) throw new BadRequestException('PayPal is not configured');
      // Reuse the cached billing plan if present; otherwise auto-create + persist it.
      let planRef = isYearly ? plan.paypalPlanYearlyId : plan.paypalPlanMonthlyId;
      if (!planRef) {
        planRef = await this.paypal.createPlan({ name: plan.name, amountCents, currency: plan.currency, interval: dto.interval });
        await this.prisma.plan.update({
          where: { id: plan.id },
          data: isYearly ? { paypalPlanYearlyId: planRef } : { paypalPlanMonthlyId: planRef },
        });
      }
      const { url } = await this.paypal.createSubscription({
        planId: planRef, tenantId: tenant.id, email, brandName: 'Lumio Booking',
        returnUrl: success, cancelUrl: cancel,
      });
      return { checkoutUrl: url, tenantId: tenant.id };
    }

    // Default: Stripe — inline price from the plan amount (no pre-created price).
    if (!(await this.stripe.isEnabled())) throw new BadRequestException('Card payment is not configured');
    const { url } = await this.stripe.createCheckoutSession({
      amountCents, currency: plan.currency, interval: dto.interval,
      productName: `${plan.name} — ${isYearly ? 'Yearly' : 'Monthly'}`,
      trialDays: plan.trialDays, customerEmail: email,
      successUrl: success, cancelUrl: cancel, metadata: meta,
    });
    return { checkoutUrl: url, tenantId: tenant.id };
  }

  /**
   * A logged-in salon subscribes to / upgrades to a plan (checkout for the
   * EXISTING tenant). The webhook then sets the tenant's plan + subscription.
   */
  async subscribeExisting(user: AuthenticatedUser, dto: { planId: string; interval: 'month' | 'year'; provider?: 'stripe' | 'paypal' }): Promise<{ checkoutUrl: string }> {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const plan = await this.prisma.plan.findFirst({ where: { id: dto.planId, isActive: true } });
    if (!plan) throw new BadRequestException('Plan not found');

    const isYearly = dto.interval === 'year';
    const amountCents = isYearly ? plan.priceYearlyCents : (plan.priceMonthlyCents || plan.priceCents);
    if (!amountCents || amountCents <= 0) throw new BadRequestException(`This plan has no ${isYearly ? 'yearly' : 'monthly'} price set`);

    const interval: BillingInterval = isYearly ? BillingInterval.YEARLY : BillingInterval.MONTHLY;
    const email = user.email;
    const success = `${this.appUrl()}/salon/billing?upgraded=1`;
    const cancel = `${this.appUrl()}/salon/billing`;
    const meta = { tenantId, planId: plan.id, interval };
    const provider = dto.provider ?? 'stripe';

    if (provider === 'paypal') {
      if (!(await this.paypal.isEnabled())) throw new BadRequestException('PayPal is not configured');
      let planRef = isYearly ? plan.paypalPlanYearlyId : plan.paypalPlanMonthlyId;
      if (!planRef) {
        planRef = await this.paypal.createPlan({ name: plan.name, amountCents, currency: plan.currency, interval: dto.interval });
        await this.prisma.plan.update({ where: { id: plan.id }, data: isYearly ? { paypalPlanYearlyId: planRef } : { paypalPlanMonthlyId: planRef } });
      }
      const { url } = await this.paypal.createSubscription({ planId: planRef, tenantId, email, brandName: 'Lumio Booking', returnUrl: success, cancelUrl: cancel });
      return { checkoutUrl: url };
    }

    if (!(await this.stripe.isEnabled())) throw new BadRequestException('Card payment is not configured');
    const { url } = await this.stripe.createCheckoutSession({
      amountCents, currency: plan.currency, interval: dto.interval,
      productName: `${plan.name} — ${isYearly ? 'Yearly' : 'Monthly'}`,
      trialDays: 0, customerEmail: email, successUrl: success, cancelUrl: cancel, metadata: meta,
    });
    return { checkoutUrl: url };
  }

  /** Stripe Billing Portal link so a salon can upgrade/downgrade/cancel/update card. */
  async billingPortal(user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon context');
    const sub = await this.prisma.subscription.findFirst({
      where: { tenantId, provider: 'stripe', externalCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { externalCustomerId: true },
    });
    if (!sub?.externalCustomerId) throw new BadRequestException('No Stripe subscription found for this salon');
    const url = await this.stripe.billingPortalUrl(sub.externalCustomerId, `${this.appUrl()}/salon/billing`);
    return { url };
  }

  // ----------------------------- Activation -----------------------------

  private mapStripeStatus(s: string): SubscriptionStatus {
    if (s === 'trialing') return SubscriptionStatus.TRIALING;
    if (s === 'active') return SubscriptionStatus.ACTIVE;
    if (s === 'canceled' || s === 'unpaid') return SubscriptionStatus.CANCELLED;
    return SubscriptionStatus.PAST_DUE; // past_due, incomplete, incomplete_expired
  }

  /** Upsert the Subscription row and flip the tenant ACTIVE/SUSPENDED. */
  private async applySubscription(params: {
    tenantId: string;
    planId?: string;
    provider: string;
    interval: BillingInterval;
    externalReference: string;
    externalCustomerId?: string | null;
    status: SubscriptionStatus;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    trialEndsAt?: Date | null;
  }) {
    const tenantActive = params.status === SubscriptionStatus.TRIALING || params.status === SubscriptionStatus.ACTIVE || params.status === SubscriptionStatus.PAST_DUE;
    await this.prisma.subscription.upsert({
      where: { externalReference: params.externalReference },
      create: {
        tenantId: params.tenantId,
        planId: params.planId!,
        provider: params.provider,
        interval: params.interval,
        status: params.status,
        externalReference: params.externalReference,
        externalCustomerId: params.externalCustomerId ?? null,
        currentPeriodStart: params.periodStart ?? null,
        currentPeriodEnd: params.periodEnd ?? null,
        trialEndsAt: params.trialEndsAt ?? null,
      },
      update: {
        status: params.status,
        interval: params.interval,
        externalCustomerId: params.externalCustomerId ?? undefined,
        currentPeriodStart: params.periodStart ?? undefined,
        currentPeriodEnd: params.periodEnd ?? undefined,
        trialEndsAt: params.trialEndsAt ?? undefined,
        cancelledAt: params.status === SubscriptionStatus.CANCELLED ? new Date() : null,
      },
    });
    await this.prisma.tenant.update({
      where: { id: params.tenantId },
      data: {
        status: tenantActive ? TenantStatus.ACTIVE : TenantStatus.SUSPENDED,
        subscriptionStatus: params.status,
        ...(params.planId ? { planId: params.planId } : {}),
      },
    });
    await this.audit.log({ tenantId: params.tenantId, userId: null, action: 'subscription.synced', resourceType: 'subscription', resourceId: params.externalReference, metadata: { provider: params.provider, status: params.status } });
  }

  // --------------------------- Stripe webhook ---------------------------

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = await this.stripe.constructEvent(rawBody, signature);
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as any;
        const meta = s.metadata ?? {};
        if (!meta.tenantId || !s.subscription) break;
        const sub = await this.stripe.getSubscription(s.subscription as string);
        await this.applySubscription({
          tenantId: meta.tenantId,
          planId: meta.planId,
          provider: 'stripe',
          interval: meta.interval === 'year' ? BillingInterval.YEARLY : BillingInterval.MONTHLY,
          externalReference: sub.id,
          externalCustomerId: (s.customer as string) ?? (sub.customer as string),
          status: this.mapStripeStatus(sub.status),
          periodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
          periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as any;
        const existing = await this.prisma.subscription.findUnique({ where: { externalReference: sub.id } });
        if (!existing) break;
        await this.applySubscription({
          tenantId: existing.tenantId,
          planId: existing.planId,
          provider: 'stripe',
          interval: existing.interval,
          externalReference: sub.id,
          externalCustomerId: existing.externalCustomerId,
          status: event.type === 'customer.subscription.deleted' ? SubscriptionStatus.CANCELLED : this.mapStripeStatus(sub.status),
          periodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
          periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
        });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as any;
        if (!inv.subscription) break;
        const existing = await this.prisma.subscription.findUnique({ where: { externalReference: inv.subscription as string } });
        if (existing) {
          await this.prisma.subscription.update({ where: { externalReference: inv.subscription as string }, data: { status: SubscriptionStatus.PAST_DUE } });
          await this.prisma.tenant.update({ where: { id: existing.tenantId }, data: { subscriptionStatus: SubscriptionStatus.PAST_DUE } });
        }
        break;
      }
      default:
        break;
    }
  }

  // --------------------------- PayPal webhook ---------------------------

  async handlePaypalWebhook(headers: Record<string, string | undefined>, body: any): Promise<void> {
    const ok = await this.paypal.verifyWebhook(headers, body);
    if (!ok) throw new BadRequestException('Invalid PayPal webhook signature');

    const type = body.event_type as string;
    const resource = body.resource ?? {};

    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED' || type === 'BILLING.SUBSCRIPTION.CREATED') {
      const tenantId = resource.custom_id;
      const subId = resource.id;
      if (!tenantId || !subId) return;
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { planId: true } });
      const nextBilling = resource.billing_info?.next_billing_time ? new Date(resource.billing_info.next_billing_time) : null;
      await this.applySubscription({
        tenantId, planId: tenant?.planId ?? undefined, provider: 'paypal',
        interval: BillingInterval.MONTHLY, externalReference: subId,
        status: SubscriptionStatus.ACTIVE, periodEnd: nextBilling,
      });
    } else if (type === 'PAYMENT.SALE.COMPLETED') {
      // Renewal payment — map via the billing agreement (subscription) id.
      const subId = resource.billing_agreement_id;
      if (!subId) return;
      const existing = await this.prisma.subscription.findUnique({ where: { externalReference: subId } });
      if (existing) {
        await this.prisma.subscription.update({ where: { externalReference: subId }, data: { status: SubscriptionStatus.ACTIVE } });
        await this.prisma.tenant.update({ where: { id: existing.tenantId }, data: { status: TenantStatus.ACTIVE, subscriptionStatus: SubscriptionStatus.ACTIVE } });
      }
    } else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED' || type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      const subId = resource.id;
      const existing = await this.prisma.subscription.findUnique({ where: { externalReference: subId } });
      if (existing) {
        await this.prisma.subscription.update({ where: { externalReference: subId }, data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() } });
        await this.prisma.tenant.update({ where: { id: existing.tenantId }, data: { status: TenantStatus.SUSPENDED, subscriptionStatus: SubscriptionStatus.CANCELLED } });
      }
    }
  }
}
