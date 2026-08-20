import { IsIn, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/** Editable fields of a tenant. SUPER_ADMIN only. */
export class UpdateTenantDto {
  /**
   * Move a salon to a different market.
   *
   * This changes the LABEL and which features are offered — it deliberately
   * does NOT rewrite currency, timezone or prices. Those presets apply when a
   * salon is created, because rewriting the currency of a salon that already
   * has priced services and booked appointments would change what every
   * customer is charged. Correcting a mistake here is a two-step job on
   * purpose: set the market, then adjust money under Settings if it is wrong.
   */
  @IsOptional()
  @IsIn(['US', 'CA', 'VN'])
  market?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

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

  @IsOptional()
  @IsIn(['SALON', 'RESTAURANT'])
  businessType?: 'SALON' | 'RESTAURANT';
}
