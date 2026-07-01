import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
