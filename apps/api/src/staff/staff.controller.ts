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
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { CreateStaffLoginDto } from './dto/create-staff-login.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.staffService.list(user);
  }

  // ---- Self-service: a staff member views/edits their OWN profile photo. ----
  // Declared before ':id' so "me" isn't captured as an id. Method-level @Roles
  // overrides the class-level SALON_ADMIN restriction.
  @Get('me')
  @Roles(UserRole.STAFF, UserRole.SALON_ADMIN)
  myProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.staffService.getMyProfile(user);
  }

  @Patch('me')
  @Roles(UserRole.STAFF, UserRole.SALON_ADMIN)
  updateMyProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMyProfileDto) {
    return this.staffService.updateMyProfile(user, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffService.getById(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStaffDto) {
    return this.staffService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffService.remove(user, id);
  }

  // Create a login account for this staff member (so they can sign in).
  @Post(':id/login')
  createLogin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateStaffLoginDto,
  ) {
    return this.staffService.createLogin(user, id, dto);
  }
}
