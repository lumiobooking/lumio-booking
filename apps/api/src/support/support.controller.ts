import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SupportService, SUPPORT_ROLE } from './support.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

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

  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts')
  create(@Body() dto: { email?: string; password?: string; firstName?: string; lastName?: string; supportLevel?: string }) {
    return this.svc.createAccount(dto || {});
  }

  /** What this employee may see inside a salon. Applies from their next entry. */
  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts/:id/level')
  @HttpCode(200)
  setLevel(@Param('id') id: string, @Body() dto: { supportLevel?: string }) {
    return this.svc.setAccountLevel(id, dto?.supportLevel);
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
