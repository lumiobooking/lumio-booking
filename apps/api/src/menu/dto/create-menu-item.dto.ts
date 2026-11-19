import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, IsIn, Max } from 'class-validator';

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Giá gạch: a percent (0–90) or an amount off (wins when > 0); common/discount.ts. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountCents?: number;

  @IsOptional()
  @IsIn(['percent', 'amount', 'none'])
  discountKind?: 'percent' | 'amount' | 'none';

  // Data URL from the uploader, or a hosted /menu/... path. Capped generously
  // so an inline photo fits but a runaway payload is still rejected.
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
