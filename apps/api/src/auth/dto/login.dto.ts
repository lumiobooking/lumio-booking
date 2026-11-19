import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** An e-mail, or (rt202) the phone number a team member joined with. */
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /** Cloudflare Turnstile answer from the sign-in page ("I am not a robot"); checked when LOGIN_TURNSTILE_SECRET is set. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
