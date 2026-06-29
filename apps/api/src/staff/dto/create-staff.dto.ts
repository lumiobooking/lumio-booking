import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StaffRole } from '@prisma/client';
import { Type } from 'class-transformer';

/** One recurring weekly working-hours slot for a staff member. */
export class WorkingHourDto {
  @IsInt()
  @Min(0)
  @Max(6) // 0 = Sunday ... 6 = Saturday
  dayOfWeek!: number;

  @IsString()
  startTime!: string; // "09:00"

  @IsString()
  endTime!: string; // "17:30"
}

export class CreateStaffDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  // Public avatar image URL shown to customers on the booking page.
  @IsOptional()
  @IsString()
  @MaxLength(700000) // allows a small uploaded image stored as a data: URL
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Feature-permission role (MANAGER / RECEPTIONIST / TECHNICIAN). Drives RBAC
  // and the default of takesAppointments. Defaults to TECHNICIAN when omitted.
  @IsOptional()
  @IsEnum(StaffRole)
  staffRole?: StaffRole;

  // Bookable technician? If omitted, derived from staffRole (TECHNICIAN = true,
  // MANAGER / RECEPTIONIST = false). Lets an owner/manager who also does nails opt in.
  @IsOptional()
  @IsBoolean()
  takesAppointments?: boolean;

  // Optional: create a login for this person in the same step. Both must be set.
  // Receptionists/managers need this to sign in (POS / management).
  @IsOptional()
  @IsEmail()
  loginEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt max input
  loginPassword?: string;

  // Services this staff member can perform (skills). Must belong to the tenant.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourDto)
  workingHours?: WorkingHourDto[];
}
