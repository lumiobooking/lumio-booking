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
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // The owner sees everything. A staff account at the desk (till, calendar,
  // walk-ins, bookings) gets the desk view: the keys those screens read, and
  // none of the owner's credentials or policies. Every PATCH below stays owner-only.
  @Get()
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('pos', 'calendar', 'bookings', 'walkins', 'customers')
  get(@CurrentUser() user: AuthenticatedUser) {
    return user.role === UserRole.STAFF ? this.settings.getForDesk(user) : this.settings.get(user);
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
  updateAnalytics(@CurrentUser() user: AuthenticatedUser, @Body() dto: { ga4Id?: string; gtmId?: string; mode?: string; adsId?: string; adsLabel?: string }) {
    return this.settings.updateAnalytics(user, dto);
  }

  /**
   * What the business is, in its own words.
   *
   * The salon owns this, not Super Admin: they are the only ones who know who
   * they serve, and the engines that used to guess it from a four-value enum
   * now read this first.
   */
  // One note every AI assistant reads (hotline, Messenger, web chat, Zalo).
  @Get('ai-notes')
  aiNotes(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getAiNotesFor(user);
  }

  @Patch('ai-notes')
  updateAiNotes(@CurrentUser() user: AuthenticatedUser, @Body() dto: { text?: string }) {
    return this.settings.updateAiNotes(user, dto);
  }

  // The line of business (Nail, Mi, Nha khoa, Nhà hàng…): decides the words
  // and the menu on this salon's screens. Owner only (class @Roles).
  @Get('industry')
  industry(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getIndustryFor(user);
  }

  @Patch('industry')
  updateIndustry(@CurrentUser() user: AuthenticatedUser, @Body() dto: { industry?: string }) {
    return this.settings.updateIndustry(user, dto?.industry);
  }

  // Follow-up for quiet Messenger / Instagram booking chats — per salon, off by default.
  @Get('chat-followup')
  chatFollowUp(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getChatFollowUp(user);
  }

  @Patch('chat-followup')
  updateChatFollowUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: { enabled?: boolean; firstAfterMin?: number; secondAfterMin?: number; hourFrom?: number; hourTo?: number }) {
    return this.settings.updateChatFollowUp(user, dto as Record<string, unknown>);
  }

  @Patch('business-profile')
  updateBusinessProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { whatWeDo?: string; whoWeServe?: string; languages?: string; serviceArea?: string; edge?: string; avoid?: string; trade?: string },
  ) {
    return this.settings.updateBusinessProfile(user, dto);
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

  // Per-guest deposit for big parties (restaurants). Owner only.
  @Get('party-deposit')
  partyDeposit(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getPartyDepositFor(user);
  }

  @Patch('party-deposit')
  updatePartyDeposit(@CurrentUser() user: AuthenticatedUser, @Body() dto: { enabled?: boolean; fromParty?: number; perPersonCents?: number }) {
    return this.settings.updatePartyDeposit(user, dto);
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
    @Body() dto: { enabled?: boolean; message?: string; rules?: Array<{ day: number; categoryId: string | null; percent: number }>; startDate?: string | null; endDate?: string | null },
  ) {
    return this.settings.updateWeekdayDiscounts(user, dto);
  }

  @Patch('first-visit-discount')
  updateFirstVisitDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; percent?: number; message?: string; rules?: Array<{ visit?: number; percent?: number }>; startDate?: string | null; endDate?: string | null },
  ) {
    return this.settings.updateFirstVisitDiscount(user, dto);
  }

  @Patch('group-discount')
  updateGroupDiscount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; message?: string; tiers?: Array<{ minSize?: number; percent?: number }>; startDate?: string | null; endDate?: string | null },
  ) {
    return this.settings.updateGroupDiscount(user, dto);
  }

  @Patch('date-discounts')
  updateDateDiscounts(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; rules?: Array<{ startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }> },
  ) {
    return this.settings.updateDateDiscounts(user, dto);
  }

  // The printed bill: header text, what to show, paper, language, footer.
  @Patch('receipt')
  updateReceipt(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, unknown>) {
    return this.settings.updateReceipt(user, dto as never);
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
      cardSurchargePercent?: number;
      cardSurchargeEnabled?: boolean;
      transferInstructions?: string;
      transferQrUrl?: string;
      paymentMethods?: string[];
      // Per-method bank details and QR image. A Vietnamese till has six buttons
      // and VietQR / MoMo / ZaloPay are three different QR images.
      paymentDetails?: Record<string, { instructions?: string; qrUrl?: string }>;
      tipsEnabled?: boolean;
      requireShift?: boolean;
    },
  ) {
    return this.settings.updatePos(user, dto);
  }
}
