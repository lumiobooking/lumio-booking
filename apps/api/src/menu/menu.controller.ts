import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ImportMenuDto } from './dto/import-menu.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Restaurant menu management (Salon Admin = restaurant owner/manager).
@Roles(UserRole.SALON_ADMIN)
@Controller('menu-items')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.menu.list(user);
  }

  // Categories (Danh mục): create, order, rename, delete. Declared before
  // ':id' so "categories" is never read as a dish id.
  @Get('categories')
  categories(@CurrentUser() user: AuthenticatedUser) {
    return this.menu.categories(user);
  }

  @Post('categories')
  addCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: { name?: string }) {
    return this.menu.addCategory(user, body?.name);
  }

  @Post('categories/order')
  orderCategories(@CurrentUser() user: AuthenticatedUser, @Body() body: { names?: string[] }) {
    return this.menu.orderCategories(user, body?.names);
  }

  @Post('categories/rename')
  renameCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: { from?: string; to?: string }) {
    return this.menu.renameCategory(user, body?.from, body?.to);
  }

  @Post('categories/delete')
  deleteCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: { name?: string }) {
    return this.menu.deleteCategory(user, body?.name);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMenuItemDto) {
    return this.menu.create(user, dto);
  }

  /** The whole menu from the sheet template: created or updated by name, never doubled. */
  @Post('import')
  importMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportMenuDto) {
    return this.menu.importMany(user, dto.items);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menu.update(user, id, dto);
  }

  // DELETE /menu-items (no id) clears the whole menu for this tenant — recovery
  // from a wrong bulk import. Kept above :id is unnecessary (distinct patterns).
  @Delete()
  removeAll(@CurrentUser() user: AuthenticatedUser) {
    return this.menu.removeAll(user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.menu.remove(user, id);
  }
}
