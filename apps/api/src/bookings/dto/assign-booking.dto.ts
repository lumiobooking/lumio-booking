import { IsString } from 'class-validator';

export class AssignBookingDto {
  @IsString()
  staffId!: string;
}
