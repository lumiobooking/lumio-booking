import {
  IsIn,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

/**
 * Payload to create a new salon (tenant) together with its first Salon Admin
 * login account. Used by SUPER_ADMIN only.
 */
export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /**
   * Which market this salon trades in. One choice that carries the timezone,
   * country, currency, decimals and tipping convention that always travel
   * together — see common/markets.ts.
   *
   * Optional, and absent means US: that is what every salon created before this
   * field existed is, so the default has to be the old behaviour.
   */
  @IsOptional()
  @IsIn(['US', 'CA', 'VN'])
  market?: string;

  /** Overrides the market's default timezone when the salon states its own. */
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactEmail?: string;

  // First Salon Admin account for this salon.
  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt max input length
  adminPassword!: string;

  @IsOptional()
  @IsString()
  adminFirstName?: string;

  @IsOptional()
  @IsString()
  adminLastName?: string;
}
