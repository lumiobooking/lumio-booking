import { Body, Controller, Get, Patch, Post, Param } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CampaignsService } from './campaigns.service';
import { CampaignKey, DEFAULT_CAMPAIGN_SETTINGS } from './campaigns.constants';

/**
 * The offer attached to a campaign. This MUST be declared: the global validation
 * pipe runs with whitelist:true, so any property missing from the DTO is stripped
 * from the request — which silently reverted every saved offer to "off".
 */
class CampaignOfferDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['percent', 'amount', 'gift']) kind?: 'percent' | 'amount' | 'gift';
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) value?: number;
  @IsOptional() @IsString() @MaxLength(120) gift?: string;
  @IsOptional() @IsString() @MaxLength(16) code?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) expiryDays?: number;
}

class CampaignMessageDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @IsString() @MaxLength(600) smsBody?: string;
  @IsOptional() @ValidateNested() @Type(() => CampaignOfferDto) offer?: CampaignOfferDto;
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

class TestSendDto {
  @IsIn(['winBack', 'reactivation', 'birthday']) campaign!: CampaignKey;
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
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

  /**
   * The recommended templates. A salon that saved the old copy keeps it forever
   * otherwise — new defaults only apply to salons that never touched theirs.
   */
  @Get('defaults')
  defaults() {
    return DEFAULT_CAMPAIGN_SETTINGS;
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

  /** Send a sample of one campaign to the admin's own email/phone (template + delivery test). */
  /**
   * Till: what is this promo code worth? Returns null when the code is not live.
   *
   * STAFF is allowed here on purpose — the person on the register is usually a
   * receptionist or technician, not the salon admin. Without this the code
   * lookup 403s and the promo box silently stays empty, which looks exactly
   * like "the feature does not work".
   */
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Get('code/:code')
  lookupCode(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.campaigns.lookupCode(user, code);
  }

  @Post('test')
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: TestSendDto) {
    return this.campaigns.testSend(user, dto);
  }
}
