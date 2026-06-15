import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

/** Creates a STAFF login account for a staff member. */
export class CreateStaffLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt max input
  password!: string;
}
