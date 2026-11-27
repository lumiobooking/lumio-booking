import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ChatTurnsService } from './chat-turns.service';
import { StaffAlertsService } from './staff-alerts.service';

export class ChatTurnSettingsDto {
  @IsOptional() @IsIn(['off', 'round-robin']) mode?: 'off' | 'round-robin';
  @IsOptional() @IsIn(['strict', 'least-busy', 'weighted']) rotation?: 'strict' | 'least-busy' | 'weighted';
  @IsOptional() @IsBoolean() botFirst?: boolean;
  @IsOptional() @IsBoolean() needStatus?: boolean;
  @IsOptional() @IsBoolean() needShift?: boolean;
  @IsOptional() @IsBoolean() needOnline?: boolean;
  @IsOptional() @IsBoolean() preferUsualTech?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(120) onlineMins?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) maxOpenPerAgent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) reassignUnreadMins?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) reassignUnrepliedMins?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) maxHops?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) reassignAdMins?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) escalateMins?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) agentIds?: string[];
}

export class ChatStatusDto {
  @IsIn(['available', 'away']) status!: 'available' | 'away';
}

export class ChatBacklogDto {
  @IsOptional() @IsInt() @IsIn([7, 30, 90]) days?: number;
}

export class ChatShiftDto {
  @IsBoolean() on!: boolean;
}

export class AssignThreadDto {
  @IsOptional() @IsString() @MaxLength(64) userId?: string | null;
}

/**
 * Chat turns. Reading the team and your own status, and moving your own
 * conversations, is for everyone who works the inbox; changing the rules is
 * the salon admin's (enforced again in the service). Every route resolves the
 * tenant from the caller — nothing here takes a tenant id from the request.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('messenger')
export class ChatTurnsController {
  constructor(private readonly turns: ChatTurnsService, private readonly alerts: StaffAlertsService) {}

  /** My own Messenger as my turn alert: linked? on shift? (each person sees only their own). */
  @Get('turns/messenger')
  myMessenger(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.mine(user);
  }

  /** A one-time code to send to the salon's Page ("LUMIO 123456"), 15 minutes. */
  @Post('turns/messenger/code')
  messengerCode(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.newCode(user);
  }

  @Post('turns/messenger/unlink')
  messengerUnlink(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.unlink(user);
  }

  /** Groups, weights, Pages per person and the Inbox permissions (đợt 2). Reading: the team; saving: the owner. */
  @Get('turns/team')
  team(@CurrentUser() user: AuthenticatedUser) {
    return this.turns.team(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  @Post('turns/team')
  saveTeam(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) {
    return this.turns.saveTeam(user, dto);
  }

  /** The scoreboard (đợt 3): the owner sees everyone, staff only their own row. */
  @Get('turns/scoreboard')
  scoreboard(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    return this.turns.scoreboardView(user, Number(days) || 1);
  }

  /** rt245: leads by day / week / month — each person and the whole salon. Owner: everyone + salon; staff: their own. */
  @Get('turns/lead-report')
  leadReport(@CurrentUser() user: AuthenticatedUser, @Query('by') by?: string, @Query('format') format?: string) {
    return format === 'csv' ? this.turns.leadReportCsv(user, by) : this.turns.leadReportView(user, by);
  }

  /** rt216: every turn someone let go — not opened, not answered, skipped. Owner: everyone; staff: their own. */
  @Get('turns/misses')
  misses(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string, @Query('person') person?: string) {
    return this.turns.missLog(user, Number(days) || 7, person || undefined);
  }

  @Get('turns')
  view(@CurrentUser() user: AuthenticatedUser) {
    return this.turns.view(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('messengerAi')
  @Post('turns/settings')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatTurnSettingsDto) {
    return this.turns.updateSettings(user, dto as unknown as Record<string, unknown>);
  }

  /** rt210: put every rule back to the standard setup (who takes turns is kept). */
  @Roles(UserRole.SALON_ADMIN)
  @Post('turns/standard')
  standard(@CurrentUser() user: AuthenticatedUser) {
    return this.turns.applyStandard(user);
  }

  /** rt211: give out the old conversations nobody holds, to follow up. */
  @Roles(UserRole.SALON_ADMIN)
  @Post('turns/backlog')
  backlog(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatBacklogDto) {
    return this.turns.distributeBacklog(user, dto.days);
  }

  @Post('turns/status')
  status(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatStatusDto) {
    return this.turns.setStatus(user, dto.status);
  }

  /** rt198: "Vào ca" / "Ra ca" — each person, their own shift only. */
  @Post('turns/shift')
  shift(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatShiftDto) {
    return this.turns.setShift(user, dto.on);
  }

  @Post('turns/heartbeat')
  heartbeat(@CurrentUser() user: AuthenticatedUser) {
    return this.turns.heartbeat(user);
  }

  @Post('threads/:id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignThreadDto) {
    return this.turns.assign(user, id, dto.userId ? String(dto.userId) : null);
  }
}
