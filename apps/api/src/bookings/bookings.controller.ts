import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { AssignBookingDto } from './dto/assign-booking.dto';
import { RejectBookingDto } from './dto/reject-booking.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * Bookings. Roles are applied PER METHOD (method-level @Roles overrides any
 * class-level metadata): Salon Admin manages bookings; Staff act on their own
 * assigned bookings (accept/reject + their queue).
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  // ---- Staff: their own work queue + accept/reject -----------------------

  // GET /api/bookings/my -> bookings assigned to the signed-in staff member.
  @Roles(UserRole.STAFF)
  @Get('my')
  myBookings(@CurrentUser() user: AuthenticatedUser, @Query() filters: ListBookingsDto) {
    return this.bookings.listMyAssignments(user, filters);
  }

  @Roles(UserRole.STAFF)
  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.accept(user, id);
  }

  @Roles(UserRole.STAFF)
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectBookingDto,
  ) {
    return this.bookings.reject(user, id, dto.reason);
  }

  // ---- Salon Admin: management ------------------------------------------

  @Roles(UserRole.SALON_ADMIN)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() filters: ListBookingsDto) {
    return this.bookings.list(user, filters);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.getById(user, id);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  // Run the assignment engine on a pending booking.
  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/auto-assign')
  @HttpCode(200)
  autoAssign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.autoAssign(user, id);
  }

  // Process assignments whose staff did not respond in time (no-response).
  @Roles(UserRole.SALON_ADMIN)
  @Post('process-timeouts')
  @HttpCode(200)
  processTimeouts(@CurrentUser() user: AuthenticatedUser) {
    return this.bookings.processTimeouts(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/assign')
  @HttpCode(200)
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignBookingDto,
  ) {
    return this.bookings.assign(user, id, dto.staffId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.cancel(user, id);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.complete(user, id);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.noShow(user, id);
  }
}
