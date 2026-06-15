import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { Public } from '../auth/decorators/public.decorator';

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

  private async resolveTenantId(slug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Salon not found');
    }
    return tenant.id;
  }

  // GET /api/public/salons/:slug -> public salon info + branding + booking rules
  // for the customer booking page.
  @Get(':slug')
  async salon(@Param('slug') slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true, name: true, slug: true, timezone: true, branding: true },
    });
    if (!tenant) {
      throw new NotFoundException('Salon not found');
    }
    return {
      name: tenant.name,
      slug: tenant.slug,
      timezone: tenant.timezone,
      branding: this.settings.brandingFrom(tenant.branding),
      booking: await this.settings.getBookingRules(tenant.id),
    };
  }

  @Get(':slug/services')
  async services(@Param('slug') slug: string) {
    return this.bookings.publicServices(await this.resolveTenantId(slug));
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
  @Post(':slug/bookings')
  async createBooking(@Param('slug') slug: string, @Body() dto: CreateBookingDto) {
    const tenantId = await this.resolveTenantId(slug);
    const safeDto: CreateBookingDto = { ...dto, staffId: undefined };
    let booking = await this.bookings.createForTenant(tenantId, safeDto, null);

    // Auto-assign (fair rotation) if the salon's assignment mode is 'auto'.
    const rules = await this.settings.getBookingRules(tenantId);
    if (rules.assignmentMode === 'auto') {
      const result = await this.bookings.autoAssignForTenant(tenantId, booking.id);
      if (result?.booking) booking = result.booking;
    }

    let payment = null;
    if (dto.paymentType) {
      payment = await this.payments.createForBookingTenant(
        tenantId,
        booking.id,
        dto.paymentType,
        null,
      );
    }

    return { booking, payment };
  }
}
