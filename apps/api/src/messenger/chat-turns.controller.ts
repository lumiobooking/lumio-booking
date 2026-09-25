import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ChatTurnsService } from './chat-turns.service';

export class ChatTurnSettingsDto {
  @IsOptional() @IsIn(['off', 'round-robin']) mode?: 'off' | 'round-robin';
  @IsOptional() @IsIn(['strict', 'least-busy']) rotation?: 'strict' | 'least-busy';
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
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) agentIds?: string[];
}

export class ChatStatusDto {
  @IsIn(['available', 'away']) status!: 'available' | 'away';
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
  constructor(private readonly turns: ChatTurnsService) {}

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

  @Post('turns/status')
  status(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatStatusDto) {
    return this.turns.setStatus(user, dto.status);
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
