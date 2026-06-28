import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SuppliesService } from './supplies.service';

class CreateSupplyDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) stockQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) lowStockThreshold?: number;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsString() @MaxLength(120) supplier?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateSupplyDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) stockQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) lowStockThreshold?: number;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsString() @MaxLength(120) supplier?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AdjustDto {
  @IsInt() @Min(-1_000_000) @Max(1_000_000) delta!: number;
}

/** Back-of-house supplies inventory (polish, tips, powder…) — Salon Admin only. */
@Roles(UserRole.SALON_ADMIN)
@Controller('supplies')
export class SuppliesController {
  constructor(private readonly supplies: SuppliesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.supplies.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplyDto) {
    return this.supplies.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSupplyDto) {
    return this.supplies.update(user, id, dto);
  }

  @Patch(':id/adjust')
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AdjustDto) {
    return this.supplies.adjust(user, id, dto.delta);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplies.remove(user, id);
  }
}
