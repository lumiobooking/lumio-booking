import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

/** Editable fields of a tenant. SUPER_ADMIN only. */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

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
}
