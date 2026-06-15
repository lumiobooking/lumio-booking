import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TenantStatus } from '@prisma/client';

/** Optional filters for listing tenants (SUPER_ADMIN). */
export class ListTenantsDto {
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @IsOptional()
  @IsString()
  search?: string; // matches name or slug
}
