import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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
