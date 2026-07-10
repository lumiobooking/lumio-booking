import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StationsService } from './stations.service';
import { BulkCreateStationDto, CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

// Salon chairs/stations. Reading is allowed for STAFF too (the floor view / their
// chair); create/update/delete stay Salon-Admin-only.
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

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
