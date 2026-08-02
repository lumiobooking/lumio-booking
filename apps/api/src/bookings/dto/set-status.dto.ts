import { IsEnum } from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

/** Target status for a manual status change (either direction). */
export class SetStatusDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;
}
