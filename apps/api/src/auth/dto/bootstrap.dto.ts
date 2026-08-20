import { IsEmail, IsString, MinLength } from 'class-validator';

/** Creating the first Super Admin on an empty deployment. */
export class BootstrapDto {
  @IsEmail()
  email!: string;

  // The real strength rules live in passwordProblem(); this is only the floor
  // that stops obviously empty input reaching the service.
  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  @MinLength(16)
  token!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}
