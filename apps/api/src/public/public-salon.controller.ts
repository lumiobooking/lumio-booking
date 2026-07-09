import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
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
    const [booking, weekdayDiscounts, dateDiscounts, deposit, areaRows] = await Promise.all([
      this.settings.getBookingRules(tenant.id),
      this.settings.getWeekdayDiscounts(tenant.id),
      this.settings.getDateDiscounts(tenant.id),
      this.settings.getDepositSettings(tenant.id),
      this.prisma.restaurantTable.findMany({ where: { tenantId: tenant.id, isActive: true, area: { not: null } }, select: { area: true }, distinct: ['area'] }),
    ]);
    return {
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      contactPhone: tenant.contactPhone,
      areas: areaRows.map((a: { area: string | null }) => a.area).filter((x: string | null): x is string => !!x),
      timezone: tenant.timezone,
      branding: this.settings.brandingFrom(tenant.branding),
      booking,
      weekdayDiscounts,
      dateDiscounts,
      deposit,
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

    const [extra, booking, services, agg] = await Promise.all([
      this.settings.getCompanyExtra(tenant.id),
      this.settings.getBookingRules(tenant.id),
      this.bookings.publicServices(tenant.id).catch(() => [] as Array<{ priceCents?: number }>),
      this.prisma.feedback.aggregate({ where: { tenantId: tenant.id }, _avg: { rating: true }, _count: { _all: true } }).catch(() => null),
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

    let payment = null;
    if (depositCents > 0) {
      payment = await this.payments.createDepositForBookingTenant(tenantId, booking.id, depositCents, null);
    } else if (dto.paymentType) {
      payment = await this.payments.createForBookingTenant(tenantId, booking.id, dto.paymentType, null);
    }

    return { booking, payment, depositCents };
  }
}
