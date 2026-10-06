import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';

/** The calendar's drag: a new start and, optionally, a different technician. */
export class MoveBookingDto {
  /** New start (ISO). Duration is preserved from the existing booking. */
  @IsISO8601()
  startTime!: string;

  /** The technician whose column it was dropped on; omitted = same tech. */
  @IsOptional()
  @IsString()
  staffId?: string;

  /** Owner only: move it outside opening hours on purpose. */
  @IsOptional()
  @IsBoolean()
  outsideHours?: boolean;
}
