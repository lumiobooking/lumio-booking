import { IsOptional, IsString } from 'class-validator';

/**
 * Assign (or clear) the technician of ONE service line inside a multi-service
 * appointment. The primary service keeps using the existing /assign endpoint;
 * this one targets the extra lines stored in the appointment's line-item
 * snapshot.
 */
export class LineStaffDto {
  /** The service id of the line being changed (extra lines are unique per service). */
  @IsString()
  serviceId!: string;

  /** Technician for that line; omit/null to clear back to "with the main tech". */
  @IsOptional()
  @IsString()
  staffId?: string | null;
}
