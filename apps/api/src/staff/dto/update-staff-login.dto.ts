import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

/** Owner → a staff member's EXISTING login: change the sign-in email and/or switch it on or off. */
export class UpdateStaffLoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  // false = this person can no longer sign in (and is signed out within seconds);
  // true = their access is back. Their staff record, bookings and pay are untouched.
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
