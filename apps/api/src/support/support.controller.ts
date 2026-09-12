import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SupportService, SUPPORT_ROLE } from './support.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CAP_CATALOG, SUPPORT_LEVELS, capsForLevel } from './support-scope';

/**
 * SUPPORT staff working surface. Note what is NOT here: creating, suspending
 * or deleting tenants, plans, billing, feature-policy, retention — those stay
 * SUPER_ADMIN-only in their own controllers. A SUPPORT account that calls them
 * gets the same 403 as any salon user.
 */
@Controller('support')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  /** Thin salon list (name/slug/status) for the picker. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Get('tenants')
  tenants() {
    return this.svc.listTenants();
  }

  /** What every shop has sent and nobody has made a post from yet. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Get('inbox')
  inbox() {
    return this.svc.inbox();
  }

  /** The salon list grouped for THIS employee: their team open, the rest folded. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Get('board')
  board(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.board(user);
  }

  /** Move a salon to a team. Owner and full-level accounts only. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('tenants/:tenantId/team')
  @HttpCode(200)
  setTenantTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tenantId') tenantId: string,
    @Body() dto: { team?: string },
  ) {
    return this.svc.setTenantTeam(user, tenantId, dto?.team);
  }

  /** Switch a salon's Messenger/Instagram AI on or off. Any support account: the same box is on the salon's Bot page. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('tenants/:tenantId/bot')
  @HttpCode(200)
  setTenantBot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tenantId') tenantId: string,
    @Body() dto: { on?: boolean },
  ) {
    return this.svc.setTenantBot(user, tenantId, dto?.on);
  }

  /** Move a whole batch at once — the only way fifty unfiled salons ever get filed. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('tenants/team')
  @HttpCode(200)
  setTeamForMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: { ids?: string[]; team?: string }) {
    return this.svc.setTeamForMany(user, dto?.ids, dto?.team);
  }

  /** Put an employee on a team. Same bar. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('accounts/:id/team')
  @HttpCode(200)
  setAccountTeam(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: { team?: string }) {
    return this.svc.setAccountTeam(user, id, dto?.team);
  }

  /**
   * Today's production queue across every salon — the screen two people run
   * thirty clients from. See SupportService.today.
   */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Get('today')
  today(@CurrentUser() user: AuthenticatedUser, @Query('lang') lang?: string) {
    return this.svc.today(user, lang);
  }

  /** Take a job, put it back, or mark it done. Anyone on the team, any job. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('today/state')
  @HttpCode(200)
  setJobState(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { tenantId?: string; weekKey?: string; jobId?: string; state?: string },
  ) {
    return this.svc.setJobState(user, dto ?? {});
  }

  /** Mint an 8h salon-scoped session token. Audited. */
  @Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
  @Post('enter/:tenantId')
  @HttpCode(200)
  enter(@CurrentUser() user: AuthenticatedUser, @Param('tenantId') tenantId: string) {
    return this.svc.enterSalon(user, tenantId);
  }

  // ---- Account management: the platform owner only ------------------------

  @Roles(UserRole.SUPER_ADMIN)
  @Get('accounts')
  accounts() {
    return this.svc.listAccounts();
  }

  /**
   * Every screen that can be ticked, with its Vietnamese name and whether its
   * DATA is private.
   *
   * Served rather than duplicated in the web bundle on purpose: the server is
   * the half that refuses requests, so it must also be the half that says what
   * the boxes are. A second hand-maintained list in the browser drifts, and the
   * drift shows up as a box that is ticked and does nothing.
   */
  @Roles(UserRole.SUPER_ADMIN)
  @Get('capabilities')
  capabilities() {
    return {
      caps: CAP_CATALOG,
      levels: SUPPORT_LEVELS,
      // What each preset already contains, so the tick panel can open on the
      // employee's CURRENT access instead of on an empty list. Opening empty
      // would mean the first save of a hand-picked list silently took every
      // screen away from somebody mid-job.
      presets: {
        content: capsForLevel('content'),
        setup: capsForLevel('setup'),
        full: capsForLevel('full'),
      },
    };
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts')
  create(@Body() dto: { email?: string; password?: string; firstName?: string; lastName?: string; supportLevel?: string }) {
    return this.svc.createAccount(dto || {});
  }

  /**
   * What this employee may see inside a salon. Applies from their next entry.
   *
   * One endpoint for the preset AND the hand-picked list, because they are one
   * decision: a request that omits `supportCaps` changes only the preset and
   * leaves any list alone; one that sends `[]` puts the employee back on the
   * preset. See SupportService.setAccountLevel.
   */
  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts/:id/level')
  @HttpCode(200)
  setLevel(@Param('id') id: string, @Body() dto: { supportLevel?: string; supportCaps?: string[] }) {
    return this.svc.setAccountLevel(id, dto?.supportLevel, dto && 'supportCaps' in dto ? dto.supportCaps : undefined);
  }

  /**
   * Remove an employee for good. Audited, and it ends their open salon
   * sessions — see SupportService.deleteAccount.
   */
  @Roles(UserRole.SUPER_ADMIN)
  @Delete('accounts/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.deleteAccount(user, id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts/:id/active')
  @HttpCode(200)
  setActive(@Param('id') id: string, @Body() dto: { isActive?: boolean }) {
    return this.svc.setAccountActive(id, dto?.isActive === true);
  }
}
