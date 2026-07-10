import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, IsBoolean } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { WalkinsService } from './walkins.service';

class AddWalkInDto {
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) partySize?: number;
  @IsOptional() @IsString() assignedStaffId?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsString() @MaxLength(24) station?: string;
}

class AssignDto {
  @IsString() staffId!: string;
}

class AddServiceDto {
  @IsString() serviceId!: string;
  @IsOptional() @IsString() staffId?: string;
}

class StationDto {
  @IsOptional() @IsString() @MaxLength(24) station?: string;
}

class ChairDto {
  @IsOptional() @IsString() @MaxLength(60) stationId?: string;
}

/** Walk-in queue + turn rotation — Salon Admin (front desk) only. */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('walkins')
@Controller('walkins')
export class WalkinsController {
  constructor(private readonly walkins: WalkinsService) {}

  @Get('board')
  board(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.board(user);
  }

  @Get('my')
  myChair(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.myChair(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.getOne(user, id);
  }

  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddWalkInDto) {
    return this.walkins.add(user, dto);
  }

  @Patch(':id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.walkins.assign(user, id, dto.staffId);
  }

  @Patch(':id/station')
  setStation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: StationDto) {
    return this.walkins.setStation(user, id, dto.station);
  }

  @Patch(':id/chair')
  moveToStation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ChairDto) {
    return this.walkins.moveToStation(user, id, dto.stationId);
  }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.reactivate(user, id);
  }

  @Post(':id/services')
  addService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddServiceDto) {
    return this.walkins.addService(user, id, dto.serviceId, dto.staffId);
  }

  @Delete(':id/services/:lineId')
  removeService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.walkins.removeService(user, id, lineId);
  }

  @Patch(':id/done')
  done(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.done(user, id);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.cancel(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.walkins.remove(user, id);
  }
}
