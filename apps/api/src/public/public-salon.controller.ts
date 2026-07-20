import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentOrchestrator } from '../payments-hub/payment-orchestrator.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { deviceSource } from '../bookings/booking.util';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { verifyCaptcha } from '../common/security/turnstile';

/**
 * Hosted "online booking link" flow. Unlike the WordPress plugin (which is
 * authenticated by an API key), these endpoints identify the salon by its
 * public `slug` and need no key — they power a shareable customer booking page
 * at /book/:slug. Only ACTIVE, non-deleted salons are reachable. Everything is
 * still scoped to that one tenant.
 */
@Public()
@Controller('public/salons')
export class PublicSalonController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
    private readonly hub: PaymentOrchestrator,
  ) {}

  /** A salon is reachable only if ACTIVE and not past its access expiry. */
  private isOpen(t: { status: TenantStatus; billingExempt?: boolean; accessUntil?: Date | null }): boolean {
    if (t.status !== TenantStatus.ACTIVE) return false;
    if (!t.billingExempt && t.accessUntil && t.accessUntil.getTime() < Date.now()) return false;
    return true;
  }

  private async resolveTenantId(slug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, status: true, billingExempt: true, accessUntil: true },
    });
    if (!tenant || !this.isOpen(tenant)) {
      throw new NotFoundException('Salon not found');
    }
    return tenant.id;
  }

  // GET /api/public/salons/:slug -> public salon info + branding + booking rules
  // for the customer booking page.
  @Get(':slug')
  async salon(@Param('slug') slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true, slug: true, businessType: true, timezone: true, branding: true, status: true, billingExempt: true, accessUntil: true, contactPhone: true },
    });
    if (!tenant || !this.isOpen(tenant)) {
      throw new NotFoundException('Salon not found');
    }
    // Read the settings rows in parallel (avoids sequential DB round-trips).
    const [booking, weekdayDiscounts, dateDiscounts, deposit, areaRows, extra, ratingAgg] = await Promise.all([
      this.settings.getBookingRules(tenant.id),
      this.settings.getWeekdayDiscounts(tenant.id),
      this.settings.getDateDiscounts(tenant.id),
      this.settings.getDepositSettings(tenant.id),
      this.prisma.restaurantTable.findMany({ where: { tenantId: tenant.id, isActive: true, area: { not: null } }, select: { area: true }, distinct: ['area'] }),
      // The booking widget shows the shop card (name · address · phone) next to the
      // cart, the way every modern booking site does — so the visitor always knows
      // which shop they are booking.
      this.settings.getCompanyExtra(tenant.id).catch(() => ({} as { address?: string })),
      // Real aggregate rating (same source the SEO/structured-data endpoint uses). Shown
      // as a trust badge on the booking page — only when the shop actually has reviews.
      this.prisma.feedback.aggregate({ where: { tenantId: tenant.id }, _avg: { rating: true }, _count: { _all: true } }).catch(() => null),
    ]);
    const brand = this.settings.brandingFrom(tenant.branding);
    const autoCount = (ratingAgg as { _count?: { _all?: number } } | null)?._count?._all ?? 0;
    const autoValue = (ratingAgg as { _avg?: { rating?: number | null } } | null)?._avg?.rating ?? 0;
    // Which rating to show: the salon's manual figure (e.g. their Google rating), the
    // live in-app aggregate, or nothing — their choice in Settings.
    const mode = brand.ratingMode || 'auto';
    const rating =
      mode === 'off'
        ? null
        : mode === 'manual'
          ? (brand.ratingCount > 0 ? { value: Math.round(brand.ratingValue * 10) / 10, count: brand.ratingCount } : null)
          : (autoCount > 0 ? { value: Math.round(autoValue * 10) / 10, count: autoCount } : null);
    return {
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      contactPhone: tenant.contactPhone,
      address: (extra as { address?: string })?.address || null,
      areas: areaRows.map((a: { area: string | null }) => a.area).filter((x: string | null): x is string => !!x),
      timezone: tenant.timezone,
      branding: brand,
      booking,
      weekdayDiscounts,
      dateDiscounts,
      deposit,
      analytics: await this.settings.getAnalyticsSettings(tenant.id).catch(() => ({ ga4Id: '', gtmId: '' })),
      rating,
    };
  }

  // GET /api/public/salons/:slug/table-availability?date=YYYY-MM-DD&partySize=N
  // -> restaurant table availability for the public reservation page.
  @Get(':slug/table-availability')
  async tableAvailability(
    @Param('slug') slug: string,
    @Query('date') date: string,
    @Query('partySize') partySize: string,
    @Query('area') area: string,
  ) {
    const tenantId = await this.resolveTenantId(slug);
    return this.bookings.publicTableAvailability(tenantId, date, parseInt(partySize, 10) || 1, area || undefined);
  }

  // GET /api/public/salons/:slug/menu -> active menu items for the reservation page.
  @Get(':slug/menu')
  async menu(@Param('slug') slug: string) {
    const tenantId = await this.resolveTenantId(slug);
    return this.prisma.menuItem.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true, category: true, priceCents: true, description: true },
    });
  }

  // GET /api/public/salons/:slug/seo -> structured-data payload for the booking
  // page's server-rendered metadata + JSON-LD (search & AI-assistant visibility).
  @Get(':slug/seo')
  async seo(@Param('slug') slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true, slug: true, businessType: true, timezone: true, contactEmail: true, contactPhone: true, branding: true, status: true, billingExempt: true, accessUntil: true },
    });
    if (!tenant || !this.isOpen(tenant)) throw new NotFoundException('Salon not found');

    const [extra, booking, services, agg, analytics] = await Promise.all([
      this.settings.getCompanyExtra(tenant.id),
      this.settings.getBookingRules(tenant.id),
      this.bookings.publicServices(tenant.id).catch(() => [] as Array<{ priceCents?: number }>),
      this.prisma.feedback.aggregate({ where: { tenantId: tenant.id }, _avg: { rating: true }, _count: { _all: true } }).catch(() => null),
      this.settings.getAnalyticsSettings(tenant.id),
    ]);

    const prices = (services ?? []).map((s) => s.priceCents ?? 0).filter((n) => n > 0);
    const priceFromCents = prices.length ? Math.min(...prices) : null;
    const branding = this.settings.brandingFrom(tenant.branding);
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hours = (booking.businessHours ?? []).map((h, i) => ({ day: i, closed: h.closed, open: hm(h.openMinutes), close: hm(h.closeMinutes) }));
    const ratingCount = agg?._count?._all ?? 0;
    const ratingValue = agg?._avg?.rating ?? 0;

    return {
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
      contactPhone: tenant.contactPhone ?? null,
      contactEmail: tenant.contactEmail ?? null,
      address: extra.address || null,
      website: extra.website || null,
      accentColor: branding.accentColor,
      logoUrl: branding.logoUrl || null,
      currency: booking.currency,
      priceFromCents,
      hours,
      rating: ratingCount > 0 ? { value: Math.round(ratingValue * 10) / 10, count: ratingCount } : null,
      analytics,
    };
  }

  @Get(':slug/services')
  async services(@Param('slug') slug: string) {
    return this.bookings.publicServices(await this.resolveTenantId(slug));
  }

  @Get(':slug/categories')
  async categories(@Param('slug') slug: string) {
    return this.bookings.publicCategories(await this.resolveTenantId(slug));
  }

  @Get(':slug/staff')
  async staff(@Param('slug') slug: string) {
    return this.bookings.publicStaff(await this.resolveTenantId(slug));
  }

  // GET /api/public/salons/:slug/availability?serviceId=&date=YYYY-MM-DD
  @Get(':slug/availability')
  async availability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
  ) {
    const tenantId = await this.resolveTenantId(slug);
    return this.bookings.publicAvailability(tenantId, serviceId, date);
  }

  // POST /api/public/salons/:slug/bookings -> end-customer booking (PENDING).
  // A chosen technician is treated as a preference, never a hard assignment.
  // If a paymentType is provided, a payment is created right after the booking.
  @RateLimit(12, 60_000)
  @Post(':slug/bookings')
  async createBooking(
    @Param('slug') slug: string,
    @Body() dto: CreateBookingDto,
    @Headers('user-agent') ua?: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    // Honeypot: real customers never fill the hidden `website` field. If it's
    // set, a bot filled it — pretend the booking succeeded so the spammer can't
    // tell it was rejected, but create nothing.
    if (dto.website && dto.website.trim()) {
      return { booking: { id: 'ok', status: 'PENDING' }, payment: null, depositCents: 0 };
    }
    const ip = (xff || '').split(',')[0].trim() || undefined;
    if (!(await verifyCaptcha(dto.captchaToken, ip))) {
      throw new BadRequestException('Captcha verification failed. Please try again.');
    }
    const tenantId = await this.resolveTenantId(slug);
    const safeDto: CreateBookingDto = { ...dto, staffId: undefined };
    let booking = await this.bookings.createForTenant(tenantId, safeDto, null, deviceSource(ua));

    // Auto-assign (fair rotation) if the salon's assignment mode is 'auto'.
    const rules = await this.settings.getBookingRules(tenantId);
    if (rules.assignmentMode === 'auto') {
      const result = await this.bookings.autoAssignForTenant(tenantId, booking.id);
      if (result?.booking) booking = result.booking;
    }

    // Deposit-to-hold: if the salon requires a deposit (and this customer is in
    // scope), take it as a partial online payment; otherwise honour the chosen
    // pay-online/pay-later option. Runs through the PaymentProvider, so a real
    // gateway added later charges for real with no code change here.
    const deposit = await this.settings.getDepositSettings(tenantId);
    const depositCents = await this.payments.requiredDeposit(tenantId, booking.customerId, booking.priceCents, deposit);

    // If the salon has connected a REAL online provider, don't settle the deposit
    // here — the customer pays in the provider's hosted modal and we only mark it
    // paid after verifying server-side. Salons with no provider keep the old flow.
    const onlineProvider = await this.hub.onlineProviderFor(tenantId).catch(() => null);

    let payment = null;
    if (depositCents > 0) {
      if (!onlineProvider) {
        payment = await this.payments.createDepositForBookingTenant(tenantId, booking.id, depositCents, null);
      }
    } else if (dto.paymentType) {
      payment = await this.payments.createForBookingTenant(tenantId, booking.id, dto.paymentType, null);
    }

    return { booking, payment, depositCents, onlineProvider };
  }

  /**
   * Start a hosted online checkout for a booking's deposit. The amount is
   * computed on the SERVER from the salon's deposit policy — never taken from
   * the client — so the customer cannot choose what to pay.
   */
  @RateLimit(12, 60_000)
  @Post(':slug/bookings/:id/online-checkout')
  async startOnlineCheckout(@Param('slug') slug: string, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId(slug);
    const appt = await this.prisma.appointment.findFirst({
      where: { id, tenantId },
      select: { id: true, priceCents: true, currency: true, customerId: true },
    });
    if (!appt) throw new NotFoundException('Booking not found');

    const deposit = await this.settings.getDepositSettings(tenantId);
    const amountCents = await this.payments.requiredDeposit(tenantId, appt.customerId, appt.priceCents, deposit);
    if (amountCents <= 0) throw new BadRequestException('No deposit is required for this booking');

    return this.hub.onlineStart(tenantId, amountCents, appt.currency, appt.id);
  }

  /**
   * Confirm the deposit. We verify the payment DIRECTLY with the provider by
   * our own reference and only then record it — the browser's word is not trusted.
   */
  @RateLimit(12, 60_000)
  @Post(':slug/bookings/:id/online-confirm')
  async confirmOnlineCheckout(@Param('slug') slug: string, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId(slug);
    const appt = await this.prisma.appointment.findFirst({
      where: { id, tenantId },
      select: { id: true, priceCents: true, currency: true, customerId: true },
    });
    if (!appt) throw new NotFoundException('Booking not found');

    const already = await this.prisma.payment.findFirst({ where: { tenantId, appointmentId: appt.id, status: 'PAID' } });
    if (already) return { ok: true, alreadyPaid: true };

    const res = await this.hub.onlineLookup(tenantId, appt.id);
    if (!res.approved) return { ok: false, reason: 'not_approved' };

    const deposit = await this.settings.getDepositSettings(tenantId);
    const expected = await this.payments.requiredDeposit(tenantId, appt.customerId, appt.priceCents, deposit);
    if (res.amountCents !== undefined && res.amountCents + 1 < expected) {
      return { ok: false, reason: 'amount_mismatch' };
    }

    const payment = await this.prisma.payment.create({
      data: {
        tenantId, appointmentId: appt.id, amountCents: expected, currency: appt.currency,
        type: 'PAY_ONLINE', status: 'PAID', provider: res.provider,
        providerReference: res.transactionId ?? null, paidAt: new Date(),
      },
    });
    return { ok: true, payment };
  }
}
