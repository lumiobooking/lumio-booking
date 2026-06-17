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

  @Patch('review')
  updateReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { enabled?: boolean; googlePlaceId?: string; googleReviewUrl?: string; staffPointsPerFeedback?: number; staffBonusFor5Star?: number; customerPoints?: number; minRatingForGoogle?: number; requireRealVisit?: boolean; visitWindowHours?: number; dailyCapPerStaff?: number; dedupDays?: number },
  ) {
    return this.settings.updateReview(user, dto);
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
