import { IsISO8601 } from 'class-validator';

export class RescheduleBookingDto {
  /** New start (ISO). Duration is preserved from the existing booking. */
  @IsISO8601()
  startTime!: string;
}
