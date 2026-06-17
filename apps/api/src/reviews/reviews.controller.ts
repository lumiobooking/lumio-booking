import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ReviewsService } from './reviews.service';

class SubmitFeedbackDto {
  @IsString() slug!: string;
  @IsString() staffId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

class SendDto {
  @IsString() slug!: string;
  @IsString() staffId!: string;
  @IsOptional() @IsString() @MaxLength(80) deviceId?: string;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // ---- Public (customer feedback page) ----
  @Public()
  @Get('public/review/:slug/:staffId')
  context(@Param('slug') slug: string, @Param('staffId') staffId: string) {
    return this.reviews.context(slug, staffId);
  }

  @Public()
  @Post('public/review')
  submit(@Body() dto: SubmitFeedbackDto) {
    return this.reviews.submit(dto);
  }

  /** Direct mode: log a "send to Google" tap → returns the Google URL to open. */
  @Public()
  @Post('public/review-send')
  send(@Body() dto: SendDto, @Ip() ip: string) {
    return this.reviews.logSend({ slug: dto.slug, staffId: dto.staffId, deviceId: dto.deviceId, ip });
  }

  // ---- Salon Admin ----
  @Roles(UserRole.SALON_ADMIN)
  @Get('reviews/leaderboard')
  leaderboard(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    return this.reviews.leaderboard(user, month);
  }

  /** Reset one technician's point balance to 0. */
  @Roles(UserRole.SALON_ADMIN)
  @Post('reviews/staff/:id/reset')
  resetStaff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reviews.resetStaffPoints(user, id);
  }

  /** Wipe ALL review/reward data and zero balances (post-testing cleanup). */
  @Roles(UserRole.SALON_ADMIN)
  @Post('reviews/reset-all')
  wipeAll(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.wipeAll(user);
  }

  /** Delete review/reward data within a date range. */
  @Roles(UserRole.SALON_ADMIN)
  @Post('reviews/cleanup')
  cleanup(@CurrentUser() user: AuthenticatedUser, @Body() dto: { from: string; to: string }) {
    return this.reviews.cleanupRange(user, dto.from, dto.to);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Get('reviews/feedback')
  feedback(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.recentFeedback(user);
  }

  /** Direct-mode audit trail: recent "send to Google" taps + why each counted. */
  @Roles(UserRole.SALON_ADMIN)
  @Get('reviews/sends')
  sends(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.recentSends(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('reviews/staff/:id/adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { delta: number; reason?: string }) {
    return this.reviews.adjustPoints(user, id, dto.delta, dto.reason ?? '');
  }

  // ---- Staff (self) ----
  @Roles(UserRole.STAFF, UserRole.SALON_ADMIN)
  @Get('reviews/me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.mine(user);
  }
}
