import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TenantsService, PlanInput } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * Super Admin tenant management. The whole controller is restricted to
 * SUPER_ADMIN via @Roles at the class level, enforced by the global RolesGuard.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  list(@Query() filters: ListTenantsDto) {
    return this.tenantsService.list(filters);
  }

  // Plans for the create/edit forms. Placed before :id to avoid route clash.
  @Get('plans')
  plans() {
    return this.tenantsService.listPlans();
  }

  @Post('plans')
  createPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: PlanInput) {
    return this.tenantsService.createPlan(user, dto);
  }

  @Patch('plans/:id')
  updatePlan(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PlanInput) {
    return this.tenantsService.updatePlan(user, id, dto);
  }

  // ---- Multi-branch (chain) groups. Static 'groups' routes before ':id'. ----
  @Get('groups')
  listGroups() {
    return this.tenantsService.listGroups();
  }

  @Post('groups')
  createGroup(@CurrentUser() user: AuthenticatedUser, @Body() dto: { name: string }) {
    return this.tenantsService.createGroup(user, dto.name);
  }

  @Patch('groups/:groupId')
  renameGroup(@CurrentUser() user: AuthenticatedUser, @Param('groupId') groupId: string, @Body() dto: { name: string }) {
    return this.tenantsService.renameGroup(user, groupId, dto.name);
  }

  @Post('groups/:groupId/link-user')
  @HttpCode(200)
  linkUser(@CurrentUser() user: AuthenticatedUser, @Param('groupId') groupId: string, @Body() dto: { email: string }) {
    return this.tenantsService.linkUserToGroup(user, groupId, dto.email);
  }

  @Post('groups/:groupId/unlink-user')
  @HttpCode(200)
  unlinkUser(@CurrentUser() user: AuthenticatedUser, @Body() dto: { userId: string }) {
    return this.tenantsService.unlinkUserFromGroup(user, dto.userId);
  }

  @Post(':id/reset-admin-password')
  @HttpCode(200)
  resetAdminPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { password: string },
  ) {
    return this.tenantsService.resetAdminPassword(id, dto.password, user);
  }

  @Post(':id/access')
  @HttpCode(200)
  setAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { billingExempt?: boolean; accessUntil?: string | null },
  ) {
    return this.tenantsService.setAccess(id, dto, user);
  }

  @Post(':id/admin-email')
  @HttpCode(200)
  updateAdminEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { email: string },
  ) {
    return this.tenantsService.updateAdminEmail(id, dto.email, user);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateTenantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenantsService.update(id, dto, user);
  }

  @Post(':id/group')
  @HttpCode(200)
  setTenantGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: { accountGroupId: string | null },
  ) {
    return this.tenantsService.setTenantGroup(user, id, dto.accountGroupId ?? null);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.suspend(id, user);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.reactivate(id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.remove(id, user);
  }
}
