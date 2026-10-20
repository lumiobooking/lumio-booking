import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/security/rate-limit.guard';
import { AiBrainService } from './ai-brain.service';

class SandboxMsgDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MaxLength(2000) content!: string;
}
class SandboxDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SandboxMsgDto) messages!: SandboxMsgDto[];
  @IsOptional() @IsIn(['voice', 'chat']) channel?: 'voice' | 'chat';
  @IsOptional() @IsString() @MaxLength(64) customerId?: string;
}
class MemoryNoteDto {
  @IsOptional() @IsString() @MaxLength(600) salonNote?: string;
  @IsOptional() @IsString() @MaxLength(1500) profile?: string;
}

/**
 * The salon's AI brain. Reading is for the marketing capability (the same
 * people who run the hotline and Messenger screens); changing it is for the
 * owner and managers, decided in the service.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('marketing')
@Controller('ai-brain')
export class AiBrainController {
  constructor(private readonly brain: AiBrainService) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) { return this.brain.settingsView(user); }

  // The brain is one JSON document; the service validates every field (brain-settings.ts).
  @Patch('settings')
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) { return this.brain.updateBrain(user, dto); }

  @Get('health')
  health(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) { return this.brain.health(user, Number(days) || 7); }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser, @Query('filter') filter?: string, @Query('take') take?: string) {
    return this.brain.listSessions(user, { filter, take: Number(take) || undefined });
  }

  @Get('sessions/:id')
  session(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.brain.sessionDetail(user, id); }

  @Get('callbacks')
  callbacks(@CurrentUser() user: AuthenticatedUser, @Query('all') all?: string) { return this.brain.listCallbacks(user, all !== '1'); }

  @Patch('callbacks/:id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.brain.doneCallback(user, id, true); }

  @Patch('callbacks/:id/reopen')
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.brain.doneCallback(user, id, false); }

  @Get('memories')
  memories(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) { return this.brain.listMemories(user, q); }

  @Get('memories/:customerId')
  memory(@CurrentUser() user: AuthenticatedUser, @Param('customerId') id: string) { return this.brain.memoryDetail(user, id); }

  @Patch('memories/:customerId')
  note(@CurrentUser() user: AuthenticatedUser, @Param('customerId') id: string, @Body() dto: MemoryNoteDto) { return this.brain.noteMemory(user, id, dto); }

  @Delete('memories/:customerId')
  erase(@CurrentUser() user: AuthenticatedUser, @Param('customerId') id: string) { return this.brain.deleteMemory(user, id); }

  @RateLimit(30, 60_000)
  @Post('sandbox')
  sandbox(@CurrentUser() user: AuthenticatedUser, @Body() dto: SandboxDto) { return this.brain.sandbox(user, dto); }
}
