import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CampaignsService } from './campaigns.service';

class CampaignMessageDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() @MaxLength(600) smsBody?: string;
}

class LapsedCampaignDto extends CampaignMessageDto {
  @IsOptional() @IsInt() @Min(1) @Max(3650) daysSince?: number;
}

class UpdateCampaignsDto {
  @IsOptional() @IsInt() @Min(0) @Max(23) sendHour?: number;
  @IsOptional() @ValidateNested() @Type(() => LapsedCampaignDto) winBack?: LapsedCampaignDto;
  @IsOptional() @ValidateNested() @Type(() => LapsedCampaignDto) reactivation?: LapsedCampaignDto;
  @IsOptional() @ValidateNested() @Type(() => CampaignMessageDto) birthday?: CampaignMessageDto;
}

/** Automated marketing campaigns (win-back, reactivation, birthday) — Salon Admin only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.getSettings(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCampaignsDto) {
    return this.campaigns.updateSettings(user, dto);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.getStats(user);
  }

  /** Manually run the salon's enabled campaigns now (for testing) — respects consent + dedup. */
  @Post('run-now')
  runNow(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.runNow(user);
  }
}
