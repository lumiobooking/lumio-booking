import { IsString, MinLength, MaxLength } from 'class-validator';

/** Sets a NEW password on a staff member's existing login (admin-initiated reset). */
export class ResetStaffPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt max input
  password!: string;
}
