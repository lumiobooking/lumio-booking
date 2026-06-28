import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderItemKind, PaymentMethod } from '@prisma/client';

// ----- Products -----------------------------------------------------------
export class CreateProductDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsInt() @Min(0) priceCents!: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) discountPercent?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxable?: boolean;
  @IsOptional() @IsBoolean() trackStock?: boolean;
  @IsOptional() @IsInt() @Min(0) stockQty?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) discountPercent?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxable?: boolean;
  @IsOptional() @IsBoolean() trackStock?: boolean;
  @IsOptional() @IsInt() @Min(0) stockQty?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ----- Orders -------------------------------------------------------------
export class OrderItemDto {
  @IsEnum(OrderItemKind) kind!: OrderItemKind;
  @IsOptional() @IsString() serviceId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsString() @MaxLength(160) name!: string;
  @IsInt() @Min(0) unitPriceCents!: number;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsInt() @Min(0) tipCents?: number;
  @IsOptional() @IsString() staffMemberId?: string;
}

export class TenderDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsInt() @Min(0) amountCents!: number;
}

export class CreateOrderDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() appointmentId?: string;
  // When checking out a walk-in, its id — the walk-in is marked Done on payment.
  @IsOptional() @IsString() walkInId?: string;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsInt() @Min(0) redeemPoints?: number; // loyalty points to redeem as a discount
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TenderDto)
  tenders?: TenderDto[];
}
