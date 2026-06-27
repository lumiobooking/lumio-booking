import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
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
}

class AssignDto {
  @IsString() staffId!: string;
}

/** Walk-in queue + turn rotation — Salon Admin (front desk) only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('walkins')
export class WalkinsController {
  constructor(private readonly walkins: WalkinsService) {}

  @Get('board')
  board(@CurrentUser() user: AuthenticatedUser) {
    return this.walkins.board(user);
  }

  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddWalkInDto) {
    return this.walkins.add(user, dto);
  }

  @Patch(':id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.walkins.assign(user, id, dto.staffId);
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
