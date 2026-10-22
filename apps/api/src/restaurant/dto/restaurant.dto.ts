import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenderDto } from '../../pos/dto/pos.dto';

export class OpenCheckDto {
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) tableIds?: string[];
  @IsOptional() @IsBoolean() takeaway?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(99) guests?: number;
  @IsOptional() @IsString() @MaxLength(140) note?: string;
}

export class UpdateCheckDto {
  @IsOptional() @IsInt() @Min(1) @Max(99) guests?: number;
  @IsOptional() @IsString() @MaxLength(140) note?: string;
  @IsOptional() @IsString() customerId?: string | null;
}

export class AddLineDto {
  @IsString() menuItemId!: string;
  /** [{ groupId, choiceIds: [] }] — checked against the dish's own groups by the service. */
  @IsOptional() @IsArray() @ArrayMaxSize(8) options?: unknown[];
  @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @IsOptional() @IsString() @MaxLength(140) note?: string;
}

export class UpdateLineDto {
  @IsOptional() @IsInt() @Min(0) @Max(99) quantity?: number;
  @IsOptional() @IsString() @MaxLength(140) note?: string;
}

export class VoidLineDto {
  @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @IsString() @MaxLength(140) reason!: string;
  @IsOptional() @IsString() @MaxLength(12) approvalPin?: string;
}

export class VoidCheckDto {
  @IsOptional() @IsString() @MaxLength(140) reason?: string;
  @IsOptional() @IsString() @MaxLength(12) approvalPin?: string;
}

export class MoveCheckDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsString({ each: true }) tableIds!: string[];
}

export class PrebillDto {
  @IsOptional() @IsBoolean() print?: boolean;
}

export class InvoiceInfoDto {
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(20) taxCode?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
}

export class PayCheckDto {
  @IsOptional() @ValidateNested() @Type(() => InvoiceInfoDto) invoice?: InvoiceInfoDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => TenderDto) tenders!: TenderDto[];
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsInt() @Min(0) manualDiscountCents?: number;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsBoolean() allowUnsent?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class SaveRestaurantSettingsDto {
  @IsObject() settings!: Record<string, unknown>;
}

export class SoldOutDto {
  @IsBoolean() soldOut!: boolean;
}

export class MergeCheckDto {
  @IsString() fromCheckId!: string;
}

export class SplitLineDto {
  @IsString() lineId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
}

export class SplitCheckDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => SplitLineDto) lines!: SplitLineDto[];
}

export class SendDto {
  /** true = fire the dishes that were held back. */
  @IsOptional() @IsBoolean() held?: boolean;
}

export class HoldDto {
  @IsBoolean() held!: boolean;
}

export class ReadyDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) lineIds!: string[];
  @IsOptional() @IsBoolean() ready?: boolean;
}

export class AcceptQrDto {
  @IsOptional() @IsBoolean() send?: boolean;
}

export class BankFeedDto {
  @IsString() @MaxLength(10) provider!: string;
}

export class GuestOrderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) lines!: unknown[];
}

export class GuestCallDto {
  @IsString() @MaxLength(20) reason!: string;
}
