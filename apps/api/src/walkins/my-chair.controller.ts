import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { WalkinsService } from './walkins.service';

class AddServiceDto {
  @IsString() serviceId!: string;
}
class ChairDto {
  @IsOptional() @IsString() @MaxLength(60) stationId?: string;
}

/**
 * The technician's own chair.
 *
 * The /walkins controller is gated by the `walkins` capability, which a TECHNICIAN
 * deliberately does NOT have (they must not see the front-desk board or the salon's
 * totals). But a tech DOES need to run their own ticket: see who is in their chair,
 * add the services they perform, pick the chair they sat the client in, send the
 * client to the front desk to pay, and close the ticket (which credits their turn).
 *
 * So those actions live here, on a separate route with NO capability gate — every
 * call is still tenant-scoped, and the service line is always credited to the
 * signed-in technician (never to someone else).
 */
@Roles(UserRole.STAFF, UserRole.SALON_ADMIN)
@Controller('my-chair')
export class MyChairController {
  constructor(private readonly walkins: WalkinsService) {}

  /** Clients in my chair + everyone else currently in the salon. */
  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.myChair(user);
  }

  /** The salon's price list (so the tech can add what they actually did). */
  @Get('services')
  services(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.servicesForChair(user);
  }

  /** The salon's chairs, with who is sitting in each one right now. */
  @Get('chairs')
  chairs(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.chairsForChair(user);
  }

  /** Add a service I performed to this client's running bill (credited to ME). */
  @Post(':id/services')
  addService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddServiceDto) {
    return this.walkins.addServiceAsMe(user, id, dto.serviceId);
  }

  @Delete(':id/services/:lineId')
  removeService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.walkins.removeService(user, id, lineId);
  }

  /** Seat this client in a chair (or clear it). */
  @Patch(':id/chair')
  chair(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ChairDto) {
    return this.walkins.moveToStation(user, id, dto.stationId);
  }

  /** Client is finished but hasn't paid: free the chair, keep the bill open. */
  @Patch(':id/wait-payment')
  waitPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.waitPayment(user, id);
  }

  /** Close the ticket (credits a turn to every tech on it). */
  @Patch(':id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.done(user, id);
  }

  /** Undo an accidental "Done". */
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.reactivate(user, id);
  }
}
