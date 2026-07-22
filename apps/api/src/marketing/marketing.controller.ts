import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { MarketingService } from './marketing.service';

/**
 * Marketing reporting + monthly-report workflow. Salon admins act on their own
 * salon; a super admin (the agency) may pass ?tenantId= / body.tenantId to work
 * on any client. Tenant safety is enforced in the service via resolveTenantScope.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

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
  @Post('channels/sync')
  syncChannel(@CurrentUser() user: AuthenticatedUser, @Body() dto: { platform: string; month: string; tenantId?: string }) {
    return this.marketing.syncChannel(user, dto.platform, dto.month, dto.tenantId);
  }
  @Delete('channels/:platform')
  disconnectChannel(@CurrentUser() user: AuthenticatedUser, @Param('platform') platform: string) {
    return this.marketing.disconnectChannel(user, platform);
  }
}
