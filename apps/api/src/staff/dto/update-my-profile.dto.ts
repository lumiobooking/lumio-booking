import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What a STAFF user may change about their OWN profile. Deliberately excludes
 * commission, active status, services — those stay admin-only.
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(700000) // small uploaded image stored as a data: URL
  avatarUrl?: string;

  // The technician's own direct-tip QR (Venmo/Zelle/Cash App), a small data URL.
  @IsOptional()
  @IsString()
  @MaxLength(900000)
  tipQrUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tipHandle?: string;
}
