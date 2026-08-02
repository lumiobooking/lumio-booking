import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Register → server: the latest customer-facing display state (+ optional
 *  server-only pay ticket used to attribute an after-payment QR tip). */
export class PushStateDto {
  @IsObject() state!: Record<string, unknown>;
  @IsOptional() @IsObject() payTicket?: Record<string, unknown>;
}

/** Paired device → server: exchange a short pairing code for the polling token. */
export class PairDto {
  @IsString() @MaxLength(24) pairCode!: string;
}

/** Paired device → server: an after-payment tip the customer chose on the iPad. */
export class DisplayTipDto {
  @IsInt() @Min(1) amountCents!: number;
}

/**
 * Self check-in sent from the paired iPad. Everything is optional except a
 * name — a customer standing at the door should never be blocked by a form.
 */
export class SelfCheckInDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(10) birthDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serviceIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(20) partySize?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
