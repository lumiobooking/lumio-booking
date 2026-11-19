import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, IsIn, Max } from 'class-validator';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /** Option groups (size, extras) — cleaned by restaurant/check-logic cleanOptionGroups. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  options?: unknown[];
}
