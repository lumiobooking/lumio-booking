import { IsOptional, IsString, MaxLength } from 'class-validator';

/** The booking's note, as the desk writes it. Empty or missing clears it. */
export class BookingNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
