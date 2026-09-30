import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CashShiftsService } from './cash-shifts.service';
import { CloseShiftDto, OpenShiftDto, ShiftMovementDto } from './dto/cash-shift.dto';

/**
 * /pos/shifts — the cashier shift the till is running.
 *
 * Whoever may ring up a sale may open, top up and close the drawer they are
 * standing at (the `pos` capability). The history of past shifts is money
 * reporting, so it sits behind `reports` like the sales report does.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('pos/shifts')
export class CashShiftsController {
  constructor(private readonly shifts: CashShiftsService) {}

  @Get('current')
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.shifts.current(user);
  }

  @Post('open')
  open(@CurrentUser() user: AuthenticatedUser, @Body() dto: OpenShiftDto) {
    return this.shifts.open(user, dto);
  }

  @Post('current/movements')
  addMovement(@CurrentUser() user: AuthenticatedUser, @Body() dto: ShiftMovementDto) {
    return this.shifts.addMovement(user, dto);
  }

  @Delete('current/movements/:id')
  removeMovement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.shifts.removeMovement(user, id);
  }

  @Post('current/close')
  close(@CurrentUser() user: AuthenticatedUser, @Body() dto: CloseShiftDto) {
    return this.shifts.close(user, dto);
  }

  @Caps('reports')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.shifts.list(user, from, to);
  }

  // Not behind `reports`: the cashier who just closed reads (and prints) the
  // sheet they signed. The id is unguessable and tenant-checked in the service.
  @Get(':id')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.shifts.detail(user, id);
  }
}
