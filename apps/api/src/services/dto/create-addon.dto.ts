import { IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';

/** An optional extra attached to a service (e.g. "Nail art"). */
export class CreateServiceAddonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(0)
  durationMinutes!: number;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // The AI and the booking page must ASK about this extra before booking
  // ("Design?") — a yes makes the visit longer.
  @IsOptional()
  @IsBoolean()
  askAtBooking?: boolean;
}

/**
 * An extra offered on MANY services at once: every service in one category
 * (categoryId), or the whole menu (categoryId empty) — "Take Off $5".
 */
export class CreateSharedAddonDto extends CreateServiceAddonDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;
}
