import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { deviceSource } from '../bookings/booking.util';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ApiTenantId } from '../common/decorators/api-tenant.decorator';

/**
 * Public endpoints consumed by the WordPress plugin. Authentication is by the
 * tenant's API key (X-Lumio-Api-Key), NOT a JWT — hence @Public to skip the
 * global JWT guard, plus ApiKeyGuard which resolves the tenant. Everything is
 * automatically scoped to that one salon.
 */
@Public()
@UseGuards(ApiKeyGuard)
@Controller('public')
export class PublicController {
  constructor(private readonly bookings: BookingsService) {}

  // GET /api/public/services
  @Get('services')
  services(@ApiTenantId() tenantId: string) {
    return this.bookings.publicServices(tenantId);
  }

  // GET /api/public/staff -> technicians a customer can request as preferred.
  @Get('staff')
  staff(@ApiTenantId() tenantId: string) {
    return this.bookings.publicStaff(tenantId);
  }

  // POST /api/public/bookings -> end-customer booking.
  // We never let the public caller hard-assign a staff member; a chosen
  // technician is treated as a PREFERENCE and the booking starts PENDING so the
  // salon (or the assignment engine) decides.
  @Post('bookings')
  createBooking(@ApiTenantId() tenantId: string, @Body() dto: CreateBookingDto, @Headers('user-agent') ua?: string) {
    const safeDto: CreateBookingDto = { ...dto, staffId: undefined };
    return this.bookings.createForTenant(tenantId, safeDto, null, 'plugin', deviceSource(ua));
  }
}
