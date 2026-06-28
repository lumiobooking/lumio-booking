import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ReferralService } from './referral.service';

class UpdateReferralDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) referrerPoints?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) refereePoints?: number;
  @IsOptional() @IsString() @MaxLength(300) message?: string;
}

/** Customer referral program — Salon Admin only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('referral')
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.referral.getSettings(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateReferralDto) {
    return this.referral.updateSettings(user, dto);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.referral.getStats(user);
  }

  /** A customer's personal referral code + shareable booking link. */
  @Get('customer/:id')
  customerLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.referral.getCustomerLink(user, id);
  }
}
