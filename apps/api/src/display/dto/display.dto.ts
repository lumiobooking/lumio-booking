import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

/** Kiosk: "is this a returning customer?" — the phone number typed on the keypad. */
export class KioskLookupDto {
  @IsString() @MaxLength(40) phone!: string;
}

/** One more person in a self check-in party: a name (optional) and their own services. */
export class CheckInGuestDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) serviceIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) addonIds?: string[];
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
  /** Add-ons of the services picked ("Nail art" on a pedicure): a line each, priced as shown. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) addonIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(20) partySize?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /**
   * The guest stepped away mid-way and the kiosk's "Still there?" ran out: keep
   * them in line (name, phone, whatever they picked) for the desk to finish —
   * "services at the chair". Never seated on a technician by itself.
   */
  @IsOptional() @IsBoolean() unfinished?: boolean;
  /** The others in the party, each with their own services → their own ticket. */
  @IsOptional() @IsArray() @ArrayMaxSize(9) @ValidateNested({ each: true }) @Type(() => CheckInGuestDto) guests?: CheckInGuestDto[];
}
