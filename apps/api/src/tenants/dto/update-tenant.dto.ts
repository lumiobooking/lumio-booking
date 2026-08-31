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
  @IsIn(['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE'])
  businessType?: 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE';

  /**
   * Where the salon actually stands.
   *
   * The content engine reads these to pick the right school calendar, prom
   * weeks and local holidays. Left empty it falls back to parsing the address
   * in Settings, and failing that it says "chưa rõ khu vực" instead of guessing
   * — so filling these in is an improvement, never a prerequisite.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  /** State / province code, e.g. "CA". Stored uppercase. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  postalCode?: string;

  /**
   * Share of service revenue paid to the technician, 0-100.
   *
   * Sent as a string from the form so an empty box can clear it; parsed and
   * range-checked in the service. Out of range is treated as "not set" rather
   * than clamped — a commission of 150% is a typo, and silently turning it
   * into 99% would hide the typo behind a plausible margin.
   */
  @IsOptional()
  @IsString()
  @MaxLength(6)
  commissionPct?: string;

  /** Comma-separated ZIPs around the shop, for area demographics. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nearbyZips?: string;
}
