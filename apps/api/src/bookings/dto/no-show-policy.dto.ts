import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class NoShowPolicyDto {
  @IsOptional() @IsInt() @Min(0) @Max(20)
  warnAt?: number;

  // null = never refuse online bookings.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(20)
  blockOnlineAt?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(36)
  months?: number;

  // false = the sweeper never marks this salon's bookings no-show by itself.
  @IsOptional() @IsBoolean()
  autoMark?: boolean;
}
