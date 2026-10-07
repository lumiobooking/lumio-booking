import { Body, Controller, Delete, Get, MessageEvent, Param, Patch, Post, Sse } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { liveEvents } from '../common/live-events';
import { UserRole } from '@prisma/client';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, IsBoolean, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { WalkinsService } from './walkins.service';

/** Someone who came in WITH the customer: their own name and services, their own ticket, no contact of their own. */
class CompanionDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serviceIds?: string[];
  @IsOptional() @IsString() assignedStaffId?: string;
}

class AddWalkInDto {
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  // YYYY-MM-DD. Feeds the birthday campaign, never required to be served.
  @IsOptional() @IsString() @MaxLength(10) birthDate?: string;
  @IsOptional() @IsString() serviceId?: string;
  // A walk-in usually asks for more than one thing at once.
  @IsOptional() @IsArray() @IsString({ each: true }) serviceIds?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(600) extraMinutes?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) partySize?: number;
  @IsOptional() @IsString() assignedStaffId?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsString() @MaxLength(24) station?: string;
  // The people who came in together: one ticket each, linked as one party.
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => CompanionDto) guests?: CompanionDto[];
}

class SeatAppointmentDto {
  // True: check in everyone booked in the same party, not just this one.
  @IsOptional() @IsBoolean() party?: boolean;
}

class AssignDto {
  @IsString() staffId!: string;
}

class LegDto {
  // A technician id, or null / empty to give the leg back to the dispatcher.
  @IsOptional() @IsString() staffId?: string | null;
  // Start it now even if she is still finishing someone ("Bắt đầu ngay").
  @IsOptional() @IsBoolean() start?: boolean;
}

class AddServiceDto {
  // One id or a batch — the front desk often adds two things at once.
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serviceIds?: string[];
  @IsOptional() @IsString() staffId?: string;
  // Minutes to tack on to the ticket's estimate (replaces the stored value).
  @IsOptional() @IsInt() @Min(0) @Max(600) extraMinutes?: number;
}

class UpdateLineDto {
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(600) durationMinutes?: number;
  @IsOptional() @IsString() staffId?: string;
}

class StationDto {
  @IsOptional() @IsString() @MaxLength(24) station?: string;
}

class TurnAdjustDto {
  @IsString() staffId!: string;
  @IsNumber() @Min(-20) @Max(20) delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** turn-rules.ts cleans every value; the DTO only keeps the shape honest. */
class TurnRulesDto {
  @IsOptional() @IsIn(['COUNT', 'MONEY', 'HYBRID']) mode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) halfBelowCents?: number;
  @IsOptional() @IsIn(['PRIORITY_LIST', 'LAST_FINISHED', 'CLOCK_IN']) tieBreak?: string;
  @IsOptional() @IsIn([1, 0.5, 0]) requestWeight?: number;
  @IsOptional() @IsIn(['ONE', 'BY_SERVICE', 'NONE']) appointmentWeight?: string;
}

class ChairDto {
  @IsOptional() @IsString() @MaxLength(60) stationId?: string;
}

/** Walk-in queue + turn rotation — Salon Admin (front desk) only. */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('walkins')
@Controller('walkins')
export class WalkinsController {
  constructor(private readonly walkins: WalkinsService) {}

  @Get('board')
  board(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.board(user);
  }

  /**
   * A nudge stream for the board: one line whenever this salon's walk-ins
   * change (a phone check-in, a "Giao", a "Huỷ"...), so the screen fetches
   * the board NOW instead of on its next poll. Carries no data — see
   * common/live-events.ts. A ping every 25s keeps proxies from closing an
   * idle stream.
   */
  @Sse('events')
  events(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const tenantId = resolveTenantScope(user) ?? '';
    return merge(
      liveEvents.stream(tenantId).pipe(map((e) => ({ data: e }))),
      interval(25_000).pipe(map(() => ({ data: { topic: 'ping', at: Date.now() } }))),
    );
  }

  /** Run a change, then tell every open board of this salon to look again. */
  private async nudge<T>(user: AuthenticatedUser, id: string | null, work: Promise<T>): Promise<T> {
    const r = await work;
    liveEvents.emit(resolveTenantScope(user), 'walkins', id ?? undefined);
    return r;
  }

  // ---- Chia tua: today's turns line by line, corrections, the rules. Declared before ':id'.
  @Get('turns')
  turns(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.turnsToday(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('turns/adjust')
  adjustTurn(@CurrentUser() user: AuthenticatedUser, @Body() dto: TurnAdjustDto) {
    return this.nudge(user, null, this.walkins.adjustTurn(user, dto));
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete('turns/adjust/:id')
  removeAdjustment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, null, this.walkins.removeAdjustment(user, id));
  }

  @Get('turn-rules')
  turnRules(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.getTurnRules(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch('turn-rules')
  updateTurnRules(@CurrentUser() user: AuthenticatedUser, @Body() dto: TurnRulesDto) {
    return this.nudge(user, null, this.walkins.updateTurnRules(user, dto));
  }

  @Get('my')
  myChair(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.myChair(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.getOne(user, id);
  }

  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddWalkInDto) {
    return this.nudge(user, null, this.walkins.add(user, dto));
  }

  @Patch(':id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.nudge(user, id, this.walkins.assign(user, id, dto.staffId));
  }

  /** Move one leg of a ticket (hands / feet …) to a technician, or back to the queue. */
  @Patch(':id/legs/:legId')
  assignLeg(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('legId') legId: string, @Body() dto: LegDto) {
    return this.nudge(user, id, this.walkins.assignLeg(user, id, legId, dto.staffId || null, !!dto.start));
  }

  /** One leg finished; the ticket stays open for the next one. */
  @Patch(':id/legs/:legId/done')
  doneLeg(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('legId') legId: string) {
    return this.nudge(user, id, this.walkins.doneLeg(user, id, legId));
  }

  @Patch(':id/station')
  setStation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: StationDto) {
    return this.nudge(user, id, this.walkins.setStation(user, id, dto.station));
  }

  @Patch(':id/chair')
  moveToStation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ChairDto) {
    return this.nudge(user, id, this.walkins.moveToStation(user, id, dto.stationId));
  }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.reactivate(user, id));
  }

  @Patch(':id/wait-payment')
  waitPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.waitPayment(user, id));
  }

  /** Everyone who came in together, for the till (see WalkinsService.party). */
  @Get('party/:groupId')
  party(@CurrentUser() user: AuthenticatedUser, @Param('groupId') groupId: string) {
    return this.walkins.party(user, groupId);
  }

  @Post('seat-appointment/:id')
  seatAppointment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto?: SeatAppointmentDto) {
    return this.nudge(user, id, dto?.party ? this.walkins.seatParty(user, id) : this.walkins.seatAppointment(user, id));
  }

  @Post(':id/services')
  addService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddServiceDto) {
    return this.nudge(user, id, this.walkins.addService(user, id, dto.serviceId, dto.staffId, dto.serviceIds, dto.extraMinutes));
  }

  // Edit one line in place: service, price, minutes or tech.
  @Patch(':id/services/:lineId')
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateLineDto,
  ) {
    return this.nudge(user, id, this.walkins.updateService(user, id, lineId, dto));
  }

  @Delete(':id/services/:lineId')
  removeService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.nudge(user, id, this.walkins.removeService(user, id, lineId));
  }

  @Patch(':id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.done(user, id));
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.cancel(user, id));
  }

  /**
   * Hard delete. Narrowed to SALON_ADMIN — which is the owner's own account and
   * a Lumio support session (support tokens carry a normal SALON_ADMIN scope),
   * and NOT a technician. Every other route on this controller is shared with
   * STAFF because a tech needs to run their own chair; deleting a visit is not
   * running a chair, and a tech who can delete a visit can delete the record of
   * a visit they were paid for.
   */
  @Roles(UserRole.SALON_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.nudge(user, id, this.walkins.remove(user, id));
  }
}
