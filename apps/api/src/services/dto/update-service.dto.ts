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

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

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

  // Menu organisation. categoryId may be null to clear.
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

  // Technicians who can perform this service. When provided, replaces the full
  // set (empty array clears all). Omit to leave staff assignments untouched.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  staffIds?: string[];
}
