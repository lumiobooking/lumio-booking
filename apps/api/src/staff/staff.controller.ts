import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { CreateStaffLoginDto } from './dto/create-staff-login.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';
import { UpdateStaffLoginDto } from './dto/update-staff-login.dto';
import { ROLE_PRESETS, STAFF_GRANTABLE, hasCapability } from '../auth/capabilities';

/** A staff row as the desk may see it: who they are and what they do — never what they earn or how they sign in. */
const PAY_FIELDS = ['commissionPercent', 'baseCents', 'payType', 'productCommissionPercent', 'hourlyRateCents', 'dailyGuaranteeCents', 'salaryPeriod', 'checkPercent', 'performanceScore', 'rewardPoints', 'permissions', 'user', 'email', 'phone'];
export function stripForDesk(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!PAY_FIELDS.includes(k)) out[k] = v;
  return out;
}
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // The team list. The desk needs it everywhere — the till assigns a sale to
  // a technician, the calendar draws a column per tech, the walk-in board
  // hands tickets out — so any desk role may read it. What a desk role may
  // NOT read is what each person is paid, or their login: those fields are
  // stripped unless the caller holds "staff" (or is the owner). Every write
  // below stays the owner's.
  @Get()
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff', 'pos', 'calendar', 'bookings', 'walkins')
  async list(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.staffService.list(user);
    const full = user.role !== UserRole.STAFF || hasCapability(user.role, user.staffRole, 'staff', user.staffCaps);
    return full ? rows : rows.map((r) => stripForDesk(r as unknown as Record<string, unknown>));
  }

  // Per-technician performance (revenue, tips, reviews, points, top service,
  // recent customers). Declared before ':id' so 'performance' isn't read as an id.
  @Get('performance')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  performance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.staffService.performance(user, from, to);
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

  // What each role starts with and what a staff account can be given — the
  // Staff page draws its permission checklist from this, so the screen and the
  // guard can never disagree. Declared before ':id'.
  @Get('access-catalog')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
  @Caps('staff')
  accessCatalog() {
    return { presets: ROLE_PRESETS, grantable: STAFF_GRANTABLE };
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

  // Change an EXISTING login: sign-in email, or switch it off/on.
  @Patch(':id/login')
  updateLogin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffLoginDto,
  ) {
    return this.staffService.updateLogin(user, id, dto);
  }

  // Reset the password on this staff member's EXISTING login.
  @Post(':id/password')
  resetLogin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResetStaffPasswordDto,
  ) {
    return this.staffService.resetLogin(user, id, dto);
  }
}
