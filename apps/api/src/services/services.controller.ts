import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateServiceAddonDto } from './dto/create-addon.dto';
import { CreateServiceCategoryDto, UpdateServiceCategoryDto } from './dto/category.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Salon Admin manages their own services. Tenant scoping is enforced in the
// service layer from the signed token, not from any client-supplied tenantId.
@Roles(UserRole.SALON_ADMIN)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  // Technicians (STAFF) may READ the service menu - needed for the "My chair"
  // running ticket. Create/update/delete stay Salon-Admin-only (class @Roles).
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.list(user);
  }

  // All add-ons for the tenant (used by the POS catalog). Two-segment path so it
  // never collides with GET /services/:id.
  @Get('addons/all')
  listAllAddons(@CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.listAllAddons(user);
  }

  // ---- Categories (menu groups). Declared before :id to avoid collision. ----
  @Get('categories')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.servicesService.listCategories(user);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceCategoryDto) {
    return this.servicesService.createCategory(user, dto);
  }

  @Patch('categories/:catId')
  updateCategory(@CurrentUser() user: AuthenticatedUser, @Param('catId') catId: string, @Body() dto: UpdateServiceCategoryDto) {
    return this.servicesService.updateCategory(user, catId, dto);
  }

  @Delete('categories/:catId')
  removeCategory(@CurrentUser() user: AuthenticatedUser, @Param('catId') catId: string) {
    return this.servicesService.removeCategory(user, catId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.servicesService.getById(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(user, dto);
  }

  /** Demo: auto-fill a relevant stock photo for every service (empty-only by default). */
  @Post('fill-sample-images')
  fillSampleImages(@CurrentUser() user: AuthenticatedUser, @Body() dto: { overwrite?: boolean }) {
    return this.servicesService.fillSampleImages(user, !!dto?.overwrite);
  }

  /**
   * Bulk import a whole menu (categories + services) in one call.
   *
   * A SALON_ADMIN imports into their own salon. A SUPER_ADMIN (platform support)
   * may target any salon by passing `tenantId` in the body — the service layer
   * validates it via resolveTenantScope, so a salon admin still cannot reach
   * another tenant even if they send one.
   */
  @Post('import')
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  bulkImport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { tenantId?: string; items: Array<{ category?: string; name: string; priceCents: number; durationMinutes?: number; priceFrom?: boolean; description?: string; imageUrl?: string }> },
  ) {
    return this.servicesService.bulkImport(user, dto?.items ?? [], dto?.tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.servicesService.remove(user, id);
  }

  // ---- Add-ons (extras) for a service ------------------------------------

  @Get(':id/addons')
  listAddons(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.servicesService.listAddons(user, id);
  }

  @Post(':id/addons')
  createAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateServiceAddonDto,
  ) {
    return this.servicesService.createAddon(user, id, dto);
  }

  @Delete(':id/addons/:addonId')
  removeAddon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('addonId') addonId: string,
  ) {
    return this.servicesService.removeAddon(user, id, addonId);
  }
}
