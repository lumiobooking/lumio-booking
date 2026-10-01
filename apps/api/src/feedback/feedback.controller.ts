import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RateLimit } from '../common/security/rate-limit.guard';
import { FeedbackService } from './feedback.service';

export class SubmitDto {
  @IsIn(['HAPPY', 'UNHAPPY']) sentiment!: 'HAPPY' | 'UNHAPPY';
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) reasons?: string[];
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsBoolean() wantsContact?: boolean;
  @IsOptional() @IsIn(['ipad', 'sms', 'email', 'qr', 'link']) source?: string;
  @IsOptional() @IsString() @MaxLength(600) photoUrl?: string;
}

export class PhotoDto {
  @IsString() @MaxLength(4_200_000) dataUrl!: string;
}

export class CaseActionDto {
  @IsIn(['take', 'contacted', 'call', 'free_fix', 'discount', 'refund', 'send_text', 'note', 'resolve', 'reopen']) action!: string;
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsString() @MaxLength(120) resolution?: string;
}

export class CoachingDto {
  @IsIn(['NOTE', 'GOAL', 'PRAISE']) kind!: string;
  @IsOptional() @IsString() @MaxLength(600) text?: string;
  @IsOptional() @IsInt() @Min(50) @Max(100) goalPct?: number;
  @IsOptional() @IsInt() @Min(7) @Max(120) goalDays?: number;
}

export class FeedbackSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() askOnDisplay?: boolean;
  @IsOptional() @IsBoolean() smsFallback?: boolean;
  @IsOptional() @IsBoolean() emailFallback?: boolean;
  @IsOptional() @IsInt() @Min(5) @Max(1440) smsDelayMinutes?: number;
  @IsOptional() @IsBoolean() receiptQr?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(365) cooldownDays?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) reasons?: string[];
  @IsOptional() @IsBoolean() askPhoto?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) replyHours?: number;
  @IsOptional() @IsBoolean() alertPush?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) alertUserIds?: string[];
  @IsOptional() @IsBoolean() techSeeOwnScore?: boolean;
  @IsOptional() @IsBoolean() techSeeReasons?: boolean;
  @IsOptional() @IsBoolean() techLeaderboard?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(20) alertSameReason?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) alertWindowDays?: number;
}

/**
 * The customer's side. No login: the per-visit token IS the credential and the
 * salon is resolved from it, never from the request.
 */
@Public()
@Controller('public/feedback')
export class PublicFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @RateLimit(60, 60_000)
  @Get(':token')
  context(@Param('token') token: string) {
    return this.feedback.publicContext(token);
  }

  @RateLimit(10, 60_000)
  @Post(':token')
  submit(@Param('token') token: string, @Body() dto: SubmitDto) {
    return this.feedback.publicSubmit(token, dto);
  }

  @RateLimit(4, 60_000)
  @Post(':token/photo')
  photo(@Param('token') token: string, @Body() dto: PhotoDto) {
    return this.feedback.publicPhoto(token, dto.dataUrl);
  }

  @RateLimit(20, 60_000)
  @Post(':token/google')
  google(@Param('token') token: string) {
    return this.feedback.publicGoogleTap(token);
  }

  @RateLimit(3, 60_000)
  @Post(':token/text-link')
  textLink(@Param('token') token: string) {
    return this.feedback.publicTextLink(token);
  }
}

/**
 * The salon's side. Owners and managers (the `reviews` capability) see and
 * work every case; the till only learns a neutral status for its own sale; a
 * technician reads their own numbers and nothing else.
 */
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  // Not behind a Feature-access switch: this is the salon's own day-to-day
  // (it rides on the till), switched on and off in its own Settings tab.
  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('staffId') staffId?: string) {
    return this.feedback.overview(user, { from, to, staffId: staffId || undefined });
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Get('staff/:id')
  staff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.feedback.staffCard(user, id, { from, to });
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Post('staff/:id/coaching')
  coaching(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CoachingDto) {
    return this.feedback.addCoaching(user, id, dto);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Get('cases')
  cases(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string, @Query('staffId') staffId?: string, @Query('q') q?: string) {
    return this.feedback.listCases(user, { status, staffId: staffId || undefined, search: q || undefined });
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Get('cases/open-count')
  openCount(@CurrentUser() user: AuthenticatedUser) {
    return this.feedback.openCount(user);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Get('cases/:id')
  getCase(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.feedback.getCase(user, id);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Post('cases/:id')
  act(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CaseActionDto) {
    return this.feedback.caseAction(user, id, dto);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('reviews')
  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.feedback.settingsView(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch('settings')
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: FeedbackSettingsDto) {
    return this.feedback.updateSettings(user, dto);
  }

  // ---- the till: a neutral status for the sale it just took ----
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos')
  @Get('orders/:orderId')
  forOrder(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.feedback.statusForOrder(user, orderId);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos')
  @Post('requests/:id/skip')
  skip(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.feedback.skip(user, id);
  }

  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos')
  @Post('requests/:id/send')
  sendNow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.feedback.sendNow(user, id);
  }

  // ---- a technician's own numbers ----
  @Roles(UserRole.STAFF)
  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.feedback.mine(user);
  }
}
