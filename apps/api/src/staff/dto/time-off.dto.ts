import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class TimeOffRequestDto {
  @Matches(DAY) startDate!: string;
  @Matches(DAY) endDate!: string;
  @IsOptional() @Matches(HM) startTime?: string | null;
  @IsOptional() @Matches(HM) endTime?: string | null;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** The owner records time off: one technician, or no staffId = the whole salon. */
export class TimeOffCreateDto extends TimeOffRequestDto {
  @IsOptional() @IsString() staffId?: string | null;
}

/** A block from the Calendar: one technician, or no staffId = the whole salon. */
export class CalendarBlockDto extends TimeOffRequestDto {
  @IsOptional() @IsString() staffId?: string | null;
}

export class TimeOffDecisionDto {
  @IsIn(['APPROVED', 'DENIED']) decision!: 'APPROVED' | 'DENIED';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** The owner's correction from the pop-up. staffId: omitted = unchanged, empty/null = the whole salon. */
export class TimeOffEditDto extends TimeOffRequestDto {
  @IsOptional() @IsString() staffId?: string | null;
}
