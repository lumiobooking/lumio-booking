import { Body, Controller, Delete, Get, MessageEvent, Param, Patch, Post, Sse } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { liveEvents } from '../common/live-events';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { WalkinsService } from './walkins.service';

class AddServiceDto {
  @IsString() serviceId!: string;
}
class ChairDto {
  @IsOptional() @IsString() @MaxLength(60) stationId?: string;
}
class SkipReasonDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
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

  /**
   * The same nudge stream as the desk's board (carries no data — see
   * common/live-events.ts), so a technician's screen shows a new customer
   * the moment the dispatcher hands her one, not on its next poll.
   */
  @Sse('events')
  events(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const tenantId = resolveTenantScope(user) ?? '';
    return merge(
      liveEvents.stream(tenantId).pipe(map((e) => ({ data: e }))),
      interval(25_000).pipe(map(() => ({ data: { topic: 'ping', at: Date.now() } }))),
    );
  }

  /** Run a change, then tell every open board and chair of this salon to look again. */
  private async nudge<T>(user: AuthenticatedUser, id: string | null, work: Promise<T>): Promise<T> {
    const r = await work;
    liveEvents.emit(resolveTenantScope(user), 'walkins', id ?? undefined);
    return r;
  }

  /** Clients in my chair + everyone else currently in the salon. */
  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.myChair(user);
  }

  /** My day: turns, my place in the rotation, the team, the queue, my money. */
  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.myDay(user);
  }

  /** My booking's customer is here: check them in and start my part. */
  @Post('appointments/:id/start')
  startAppointment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.startMyAppointment(user, id));
  }

  /** The salon's price list (so the tech can add what they actually did). */
  /** Tạm nghỉ / quay lại — her own break. */
  @Post('break')
  breakStart(@CurrentUser() user: AuthenticatedUser) {
    return this.nudge(user, null, this.walkins.setMyBreak(user, true));
  }

  @Post('back')
  breakEnd(@CurrentUser() user: AuthenticatedUser) {
    return this.nudge(user, null, this.walkins.setMyBreak(user, false));
  }

  /** She passes this customer on (bỏ qua), with a reason; the rule says what it costs. */
  @Post(':id/legs/:legId/skip')
  skip(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('legId') legId: string, @Body() dto: SkipReasonDto) {
    return this.nudge(user, id, this.walkins.skipLeg(user, id, legId, dto.reason));
  }

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
    return this.nudge(user, id, this.walkins.addServiceAsMe(user, id, dto.serviceId));
  }

  @Delete(':id/services/:lineId')
  removeService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.nudge(user, id, this.walkins.removeService(user, id, lineId));
  }

  /** Seat this client in a chair (or clear it). */
  @Patch(':id/chair')
  chair(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ChairDto) {
    return this.nudge(user, id, this.walkins.moveToStation(user, id, dto.stationId));
  }

  /** Client is finished but hasn't paid: free the chair, keep the bill open. */
  @Patch(':id/wait-payment')
  waitPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.waitPaymentAsMe(user, id));
  }

  /**
   * I'm finished with this client: closes MY part (and credits my turn). When
   * another part of the visit is still to do (feet after hands), the client
   * stays on the floor for the next technician.
   */
  @Patch(':id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.doneAsMe(user, id));
  }

  /** Undo an accidental "Done". */
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.reactivate(user, id));
  }
}
