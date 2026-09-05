import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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

  @Roles(UserRole.SUPER_ADMIN)
  @Post('accounts/:id/active')
  @HttpCode(200)
  setActive(@Param('id') id: string, @Body() dto: { isActive?: boolean }) {
    return this.svc.setAccountActive(id, dto?.isActive === true);
  }
}
