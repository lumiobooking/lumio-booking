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
  ValidateNested,
} from 'class-validator';
import { StaffRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { WorkingHourDto } from './create-staff.dto';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(700000) // allows a small uploaded image stored as a data: URL
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Staff performance score used later by the assignment engine.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  performanceScore?: number;

  // POS service commission rate (percent of service revenue).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  commissionPercent?: number;

  // Optional fixed base pay per pay period (cents). Added to commission + tips.
  @IsOptional()
  @IsInt()
  @Min(0)
  baseCents?: number;

  // Feature-permission role for this staff's login (MANAGER/RECEPTIONIST/TECHNICIAN).
  @IsOptional()
  @IsEnum(StaffRole)
  staffRole?: StaffRole;

  // Bookable technician? Controls visibility in booking / calendar / assignment.
  @IsOptional()
  @IsBoolean()
  takesAppointments?: boolean;

  // Booking-list priority: 0 = auto/fair ordering; higher = pinned to the top.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  bookingPriority?: number;

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
