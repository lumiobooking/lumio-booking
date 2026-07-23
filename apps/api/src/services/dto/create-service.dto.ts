import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Optional on purpose: salons often don't know exact timings when first
  // entering a menu. Blank -> the service default (30 min) so the booking
  // calendar always has a real duration to compute slots with.
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  // Price stored in cents to avoid floating-point money bugs.
  @IsInt()
  @Min(0)
  priceCents!: number;

  // Optional promo discount percent (0–90). Shown to customers as "-X%".
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Menu organisation.
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  priceFrom?: boolean;

  // Optional photo shown on the booking menu. Empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(700000) // allows a small uploaded (compressed) image stored inline
  imageUrl?: string | null;

  // Technicians who can perform this service (staff_services join). Lets the
  // salon pick the team right when creating the service.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  staffIds?: string[];
}
