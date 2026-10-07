import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class PayrollSettingsDto {
  @IsOptional() @IsIn(['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY']) payPeriod?: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
  @IsOptional() @Matches(DAY) periodAnchor?: string;
  @IsOptional() @IsIn(['NONE', 'PER_SERVICE', 'PERCENT']) supplyFeeMode?: 'NONE' | 'PER_SERVICE' | 'PERCENT';
  @IsOptional() @IsInt() @Min(0) @Max(100000) supplyFeeCents?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) supplyFeePercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(20) cardTipFeePercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) defaultCheckPercent?: number;
  @IsOptional() @IsIn(['LIVE', 'FINAL', 'OFF']) staffPayView?: 'LIVE' | 'FINAL' | 'OFF';
  @IsOptional() @IsIn(['SCHEDULE', 'CLOCK']) hoursSource?: 'SCHEDULE' | 'CLOCK';
}

export class AdjustmentDto {
  @IsString() @MaxLength(80) label!: string;
  @IsInt() @Min(-10000000) @Max(10000000) cents!: number;
}

export class OverrideDto {
  @IsOptional() @IsNumber() @Min(0) @Max(744) hours?: number | null;
  @IsOptional() @IsArray() @Matches(DAY, { each: true }) offDays?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AdjustmentDto) adjustments?: AdjustmentDto[];
}

export class SaveOverrideDto {
  @Matches(DAY) from!: string;
  @Matches(DAY) to!: string;
  @IsString() staffId!: string;
  @ValidateNested() @Type(() => OverrideDto) override!: OverrideDto;
}

export class FinalizeDto {
  @Matches(DAY) from!: string;
  @Matches(DAY) to!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ClockEntryDto {
  @IsString() staffId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) clockIn!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) clockOut?: string | null;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class ClockEditDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) clockIn?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) clockOut?: string | null;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** A technician's private targets (payroll/goals.ts). Empty or 0 = no goal. */
export class GoalDto {
  @IsOptional() @IsNumber() weekCents?: number | null;
  @IsOptional() @IsNumber() monthCents?: number | null;
  @IsOptional() @IsNumber() weekVisits?: number | null;
  @IsOptional() @IsNumber() monthVisits?: number | null;
}
