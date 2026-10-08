import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { MarketingService } from './marketing.service';
import { SyncQueueService } from './sync-queue.service';

/**
 * Marketing reporting + monthly-report workflow. Salon admins act on their own
 * salon; a super admin (the agency) may pass ?tenantId= / body.tenantId to work
 * on any client. Tenant safety is enforced in the service via resolveTenantScope.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(FeaturePolicyGuard)
@RequiresFeature('marketing')
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService, private readonly queue: SyncQueueService) {}

  // ---- Phase 0: live channel overview ----
  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.overview(user, from, to, tenantId);
  }

  // ---- Phase 1: assembled month data (numbers the report is written from) ----
  @Get('monthly')
  monthly(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.monthlyData(user, month, tenantId);
  }

  // ---- Spend ----
  @Get('spend')
  listSpend(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.listSpend(user, month, tenantId);
  }
  @Post('spend')
  upsertSpend(@CurrentUser() user: AuthenticatedUser, @Body() dto: { channel: string; periodMonth: string; amountCents?: number; currency?: string; reach?: number | null; clicks?: number | null; leads?: number | null; note?: string | null; tenantId?: string }) {
    return this.marketing.upsertSpend(user, dto);
  }
  @Delete('spend/:id')
  deleteSpend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.marketing.deleteSpend(user, id);
  }

  // ---- Work log ----
  @Get('worklog')
  listWorkLog(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.listWorkLog(user, month, tenantId);
  }
  @Post('worklog')
  addWorkLog(@CurrentUser() user: AuthenticatedUser, @Body() dto: { periodMonth: string; category?: string; title: string; note?: string; tenantId?: string }) {
    return this.marketing.addWorkLog(user, dto);
  }
  @Delete('worklog/:id')
  deleteWorkLog(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.marketing.deleteWorkLog(user, id);
  }

  @Post('social-manual')
  saveSocialManual(@CurrentUser() user: AuthenticatedUser, @Body() dto: { platform: string; month: string; followers?: number | null; newFollowers?: number | null; views?: number | null; engagement?: number | null; postsCount?: number | null; notes?: string | null; tenantId?: string }) {
    return this.marketing.saveSocialManual(user, dto);
  }

  @Post('gbp-reviews')
  saveGbpReviews(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; rating?: number | null; totalReviews?: number | null; newReviews?: number | null; badReviews?: number | null; tenantId?: string }) {
    return this.marketing.saveGbpReviews(user, dto);
  }

  // ---- Data health: is every connected channel being read, when, and why not ----
  @Get('health')
  health(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.queue.health(user, month, tenantId);
  }
  /** Queue a sync of this salon's month (runs within minutes; the screen polls health). */
  @Post('sync-now')
  syncNow(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; tenantId?: string }) {
    return this.queue.syncNow(user, dto.month, dto.tenantId);
  }

  // ---- Content facts: posts / interactions / top 5, computed from stored posts ----
  @Get('month-facts')
  monthFacts(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.monthFacts(user, month, tenantId);
  }

  // ---- Monthly report (AI draft → review → approve) ----
  @Get('report')
  getReport(@CurrentUser() user: AuthenticatedUser, @Query('month') month: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.getReport(user, month, tenantId);
  }
  @Post('report/generate')
  generateReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; tenantId?: string }) {
    return this.marketing.generateReport(user, dto.month, dto.tenantId);
  }
  @Patch('report')
  updateReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; content: unknown; tenantId?: string }) {
    return this.marketing.updateReport(user, dto.month, { content: dto.content, tenantId: dto.tenantId });
  }
  @Post('report/approve')
  approveReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; tenantId?: string }) {
    return this.marketing.approveReport(user, dto.month, dto.tenantId);
  }

  /** Is month-end auto-drafting on, and where does each recent month stand. */
  @Get('auto-status')
  autoStatus(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    return this.marketing.autoReportStatus(user, tenantId);
  }

  /** Manually trigger the month-end auto-draft (super admin only). For testing
   * and for re-running after a month closes. Idempotent. */
  @Post('auto-generate')
  @Roles(UserRole.SUPER_ADMIN)
  autoGenerate(@Body() dto: { month?: string }) {
    return this.marketing.runMonthlyAutoGenerate(dto?.month);
  }

  // ---- Social / ads channel connections (Phase 3) ----
  @Get('channels')
  listChannels(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    return this.marketing.listChannels(user, tenantId);
  }
  @Post('channels/connect')
  connectChannel(@CurrentUser() user: AuthenticatedUser, @Body() dto: { platform: string; externalAccountId?: string; token?: string; refreshToken?: string; clientId?: string; clientSecret?: string; developerToken?: string; tenantId?: string }) {
    return this.marketing.connectChannel(user, dto);
  }
  @Post('channels/test/:platform')
  testChannel(@CurrentUser() user: AuthenticatedUser, @Param('platform') platform: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.testChannel(user, platform, tenantId);
  }
  @Post('channels/diagnose/:platform')
  diagnoseChannel(@CurrentUser() user: AuthenticatedUser, @Param('platform') platform: string, @Query('month') month?: string, @Query('tenantId') tenantId?: string) {
    return this.marketing.diagnoseChannel(user, platform, month ?? '', tenantId);
  }
  @Post('channels/sync')
  syncChannel(@CurrentUser() user: AuthenticatedUser, @Body() dto: { platform: string; month: string; tenantId?: string }) {
    return this.marketing.syncChannel(user, dto.platform, dto.month, dto.tenantId);
  }
  /** "Đồng bộ tất cả" — every channel this salon has connected, one month. */
  @Post('channels/sync-all')
  syncAll(@CurrentUser() user: AuthenticatedUser, @Body() dto: { month: string; tenantId?: string }) {
    return this.marketing.syncAllForUser(user, dto?.month, dto?.tenantId);
  }
  /** Every active salon at once (the daily job does this on its own). */
  @Post('sync-all-tenants')
  @Roles(UserRole.SUPER_ADMIN)
  syncAllTenants(@Body() dto: { month?: string }) {
    return this.marketing.syncAllTenants(dto?.month);
  }
  @Delete('channels/:platform')
  disconnectChannel(@CurrentUser() user: AuthenticatedUser, @Param('platform') platform: string) {
    return this.marketing.disconnectChannel(user, platform);
  }
}
