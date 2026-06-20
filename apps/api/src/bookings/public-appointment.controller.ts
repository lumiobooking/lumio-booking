import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { BookingsService } from './bookings.service';

/**
 * Customer self-service from a reminder link (no login). The signed token in the
 * URL identifies the appointment; the tenant is resolved from it server-side.
 */
@Public()
@Controller('public/appt')
export class PublicAppointmentController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(':token')
  summary(@Param('token') token: string) {
    return this.bookings.apptSummaryByToken(token);
  }

  @Post(':token/confirm')
  confirm(@Param('token') token: string) {
    return this.bookings.confirmByToken(token);
  }

  @Post(':token/cancel')
  cancel(@Param('token') token: string) {
    return this.bookings.cancelByToken(token);
  }
}
