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
    return this.svc.generateAll(dto?.industry ?? 'SALON');
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
