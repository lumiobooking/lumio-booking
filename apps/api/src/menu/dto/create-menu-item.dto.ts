import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

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
