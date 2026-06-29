import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/** Issue (sell) a gift card. The sale is recorded as revenue unless recordSale=false. */
export class IssueGiftCardDto {
  @IsInt() @Min(1) @Max(100_000_00) amountCents!: number; // up to $100k

  // Optional custom code (e.g. a pre-printed plastic card number). If omitted,
  // the system generates a unique code.
  @IsOptional() @IsString() @MaxLength(40) code?: string;

  // How the buyer paid for the card (drives the revenue mirror provider).
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;

  // Count this sale as revenue (default true). Set false to just register a card
  // without recording money in (e.g. a comp / promo card).
  @IsOptional() @IsBoolean() recordSale?: boolean;

  @IsOptional() @IsString() @MaxLength(120) purchaserName?: string;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(160) recipientContact?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

/** Manual balance adjustment (top-up or correction) by the salon. */
export class AdjustGiftCardDto {
  @IsInt() amountCents!: number; // + to add, - to subtract
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
