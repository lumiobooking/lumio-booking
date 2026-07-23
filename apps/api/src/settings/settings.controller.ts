import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SettingsService } from './settings.service';
import {
  UpdateBookingRulesDto,
  UpdateBrandingDto,
  UpdateCompanyDto,
  UpdateNotificationsDto,
  UpdatePaymentsDto,
} from './dto/update-settings.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.get(user);
  }

  @Patch('company')
  updateCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCompanyDto) {
    return this.settings.updateCompany(user, dto);
  }

  @Patch('booking')
  updateBooking(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBookingRulesDto) {
    return this.settings.updateBooking(user, dto);
  }

  @Patch('payments')
  updatePayments(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePaymentsDto) {
    return this.settings.updatePayments(user, dto);
  }

  @Patch('notifications')
  updateNotifications(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationsDto) {
    return this.settings.updateNotifications(user, dto);
  }

  // Per-event notification template catalog (Amelia-style editor).
  @Patch('notification-templates')
  updateNotificationTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { templates?: Record<string, unknown> },
  ) {
    return this.settings.updateNotificationTemplates(user, dto as never);
  }

  // Sends a real test email with the saved SMTP credentials (diagnostics).
  @Post('notifications/test')
  testEmail(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.sendTestEmail(user);
  }

  // Sends a real test SMS with the salon's Twilio credentials (diagnostics).
  @Post('notifications/test-sms')
  testSms(@CurrentUser() user: AuthenticatedUser, @Body() body: { to?: string }) {
    return this.settings.sendTestSms(user, body?.to);
  }

  // Starts the Gmail OAuth flow — returns the Google consent URL to open.
  @Get('gmail/auth-url')
  gmailAuthUrl(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.gmailAuthUrl(user);
  }

  @Patch('branding')
  updateBranding(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandingDto) {
    return this.settings.updateBranding(user, dto);
  }

  @Patch('loyalty')
  updateLoyalty(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; earnPointsPerDollar?: number; redeemCentsPerPoint?: number; minRedeemPoints?: number },
  ) {
    return this.settings.updateLoyalty(user, dto);
  }

  @Patch('analytics')
  updateAnalytics(@CurrentUser() user: AuthenticatedUser, @Body() dto: { ga4Id?: string; gtmId?: string; mode?: string }) {
    return this.settings.updateAnalytics(user, dto);
  }

  @Patch('rebooking')
  updateRebooking(@CurrentUser() user: AuthenticatedUser, @Body() dto: { enabled?: boolean; daysAfter?: number; email?: boolean; sms?: boolean }) {
    return this.settings.updateRebooking(user, dto);
  }

  @Patch('review')
  updateReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; reviewMode?: string; googlePlaceId?: string; googleReviewUrl?: string; staffPointsPerFeedback?: number; staffBonusFor5Star?: number; customerPoints?: number; minRatingForGoogle?: number; requireRealVisit?: boolean; visitWindowHours?: number; dailyCapPerStaff?: number; dedupDays?: number; staffPointsPerSend?: number; sendDailyCap?: number; sendDedupHours?: number; anchorToVisits?: boolean; visitBuffer?: number; onlyBusinessHours?: boolean; postVisitEnabled?: boolean; postVisitDelayMinutes?: number; postVisitEmail?: boolean; postVisitSms?: boolean; postVisitCooldownDays?: number },
  ) {
    return this.settings.updateReview(user, dto);
  }

  @Patch('deposit')
  updateDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; type?: string; percent?: number; fixedCents?: number; scope?: string; noShowThreshold?: number },
  ) {
    return this.settings.updateDepositSettings(user, dto as never);
  }

  @Patch('reminders')
  updateReminders(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; hoursBefore1?: number; hoursBefore2?: number; channelEmail?: boolean; channelSms?: boolean },
  ) {
    return this.settings.updateReminderSettings(user, dto);
  }

  @Patch('weekday-discounts')
  updateWeekdayDiscounts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; message?: string; rules?: Array<{ day: number; categoryId: string | null; percent: number }> },
  ) {
    return this.settings.updateWeekdayDiscounts(user, dto);
  }

  @Patch('date-discounts')
  updateDateDiscounts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; rules?: Array<{ startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }> },
  ) {
    return this.settings.updateDateDiscounts(user, dto);
  }

  // POS settings: retail tax rate + receipt footer.
  @Patch('pos')
  updatePos(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    dto: {
      taxRatePercent?: number;
      receiptFooter?: string;
      primaryCardGateway?: string;
      transferInstructions?: string;
      transferQrUrl?: string;
    },
  ) {
    return this.settings.updatePos(user, dto);
  }
}
