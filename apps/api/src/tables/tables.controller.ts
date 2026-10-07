import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Restaurant table management (Salon Admin = restaurant owner/manager).
@Roles(UserRole.SALON_ADMIN)
@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tables.list(user);
  }

  // The floor map. The host at the door works it too: staff holding `bookings`.
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('bookings')
  @Get('floor')
  floor(@CurrentUser() user: AuthenticatedUser, @Query('at') at?: string) {
    return this.tables.floor(user, at);
  }

  // Moving tables on the map: owner only (class @Roles).
  @Patch('layout')
  saveLayout(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveLayoutDto) {
    return this.tables.saveLayout(user, dto.layout);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTableDto) {
    return this.tables.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.tables.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tables.remove(user, id);
  }
}
