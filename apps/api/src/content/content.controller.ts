import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ContentService } from './content.service';
import { ContentAdminService } from './content-admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * What a salon can reach: today's approved plan, and marking it done.
 *
 * Scoped to the caller's tenant on every route — a salon can never read
 * another salon's plan, and never sees a draft the Lumio team has not
 * released.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('content')
export class ContentController {
  constructor(private readonly svc: ContentService) {}

  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    return this.svc.forSalon(user, date);
  }

  /** Upcoming events + the discount advice, computed from this salon's book. */
  @Get('plan')
  plan(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.planFor(user);
  }

  /**
   * Redraft today's ideas now instead of waiting for the 6am run.
   *
   * Capped per tenant per day inside the service — every press costs a real API
   * call, and a button with no ceiling is a bill with no ceiling.
   */
  @Post('refresh')
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.refreshFor(user);
  }

  /**
   * Read the business's own website and Facebook Page and propose the profile.
   *
   * Drafts only. Everything downstream — content, ad targeting, what the
   * hotline says to a customer — is derived from these sentences, so a model's
   * reading of a marketing page is a proposal to correct, not a fact to act on.
   */
  @Post('profile/scan')
  scanProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto?: { note?: string }) {
    return this.svc.scanProfile(user, { note: dto?.note });
  }

  @Post('ideas/:id/status')
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { status: string; resultNote?: string },
  ) {
    return this.svc.setIdeaStatus(user, id, dto?.status, dto?.resultNote);
  }
}

/** The Lumio team's console: the library, the week's notes, the review queue. */
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin/content')
export class ContentAdminController {
  constructor(
    private readonly admin: ContentAdminService,
    private readonly svc: ContentService,
  ) {}

  // format library
  @Get('formats')
  formats(@Query('industry') industry?: string) {
    return this.admin.listFormats(industry);
  }

  @Post('formats')
  saveFormat(@Body() dto: never) {
    return this.admin.saveFormat(dto);
  }

  @Post('formats/seed')
  seedFormats(@Body() dto: { industry?: string }) {
    return this.admin.seedFormats(dto?.industry ?? 'SALON');
  }

  @Delete('formats/:id')
  removeFormat(@Param('id') id: string) {
    return this.admin.deleteFormat(id);
  }

  /**
   * Read every tenant's own data and list what its setup is missing.
   *
   * The answer to "why does every client look like a nail salon": each tenant
   * defaults to SALON, and nothing on any screen said so. This reads the
   * services, menus and tables each shop already recorded and reports the
   * mismatch, with the evidence quoted.
   */
  @Get('scan')
  scan() {
    return this.admin.scanTenants();
  }

  /** Apply one detected industry, after a person has read the evidence. */
  @Post('scan/apply')
  applyIndustry(@Body() dto: { tenantId: string; industry: string }) {
    return this.admin.applyIndustry(dto?.tenantId, dto?.industry);
  }

  // weekly trend notes
  @Get('notes')
  notes(@Query('industry') industry?: string) {
    return this.admin.listNotes(industry);
  }

  @Post('notes')
  saveNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: never) {
    return this.admin.saveNote(user, dto);
  }

  @Delete('notes/:id')
  removeNote(@Param('id') id: string) {
    return this.admin.deleteNote(id);
  }

  // review queue
  @Get('queue')
  queue(@Query('date') date?: string) {
    return this.admin.queue(date);
  }

  @Post('ideas/:id')
  edit(@Param('id') id: string, @Body() dto: never) {
    return this.admin.editIdea(id, dto);
  }

  @Post('publish')
  publish(@Body() dto: { ids?: string[]; forDate?: string; tenantId?: string }) {
    return this.admin.publish(dto ?? {});
  }

  @Post('discard')
  discard(@Body() dto: { ids: string[] }) {
    return this.admin.discard(dto?.ids ?? []);
  }

  /** Draft now instead of waiting for tomorrow's 6am run. */
  @Post('generate')
  generate(@Body() dto: { tenantId?: string; industry?: string; force?: boolean }) {
    if (dto?.tenantId) return this.svc.generateForTenant(dto.tenantId, { force: dto.force });
    return this.svc.generateAll(dto?.industry || null);
  }

  /**
   * Census diagnostic.
   *
   * The area figures come from an API this code was written against without
   * being able to call it. When it misbehaves, this returns the raw reason the
   * server gave rather than leaving anyone to guess which of the year, the
   * variable codes or the network is wrong.
   */
  @Get('census/:tenantId')
  census(@Param('tenantId') tenantId: string, @Query('zips') zips?: string, @Query('force') force?: string) {
    return this.svc.gather(tenantId).then((c) =>
      this.svc.areaFor(tenantId, zips?.trim() || c.nearbyZips, { force: force === '1' }));
  }

  /** The raw signal profile behind a salon's ideas — for spot-checking. */
  @Get('signals/:tenantId')
  signals(@Param('tenantId') tenantId: string) {
    return this.svc.gather(tenantId).then((c) => ({
      tenantName: c.tenantName, industry: c.industry, city: c.city,
      signals: c.signals, revenue: c.revenue,
    }));
  }
}
