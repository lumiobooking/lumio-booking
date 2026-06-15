import { IsOptional, IsString, MaxLength, IsUrl } from 'class-validator';

export class CreateApiKeyDto {
  // Human label, e.g. "Main WordPress site".
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  // Optionally record the WordPress site URL this key is for.
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(255)
  siteUrl?: string;
}
