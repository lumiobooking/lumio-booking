import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

export class RescheduleBookingDto {
  /** New start (ISO). Duration is preserved from the existing booking. */
  @IsISO8601()
  startTime!: string;

  /** Owner only: move it outside opening hours on purpose. */
  @IsOptional()
  @IsBoolean()
  outsideHours?: boolean;
}
