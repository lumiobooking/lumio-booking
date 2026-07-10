import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StationsService } from './stations.service';
import { BulkCreateStationDto, CreateStationDto, CreateStationTypeDto, UpdateStationTypeDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Salon chairs/stations + salon-managed chair types. Reading is allowed for STAFF
// (floor view / their chair); everything else is Salon-Admin-only.
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  // ---- types (declared before :id so 'types' never matches :id) ----
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Get('types')
  listTypes(@CurrentUser() user: AuthenticatedUser) {
    return this.stations.listTypes(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('types')
  createType(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStationTypeDto) {
    return this.stations.createType(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch('types/:id')
  updateType(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStationTypeDto) {
    return this.stations.updateType(user, id, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete('types/:id')
  removeType(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stations.removeType(user, id);
  }

  // ---- chairs ----
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.stations.list(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStationDto) {
    return this.stations.create(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('bulk')
  bulkCreate(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkCreateStationDto) {
    return this.stations.bulkCreate(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStationDto) {
    return this.stations.update(user, id, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stations.remove(user, id);
  }
}
