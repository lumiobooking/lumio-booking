import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaymentType } from '@prisma/client';

/**
 * Create a booking. Used by Salon Admin now; the public/WordPress flow (Step 8)
 * reuses the same core service via an API key.
 */
export class CreateBookingDto {
  @IsString()
  serviceId!: string;

  // Optional: book several services in ONE visit. The first is the primary
  // (kept in serviceId); the rest are stored as service line items. When omitted
  // or length ≤ 1, the booking behaves exactly like a single-service booking.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceIds?: string[];

  // Optional add-on (extra) ids selected for this service.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addonIds?: string[];

  // ISO 8601 start time, e.g. "2026-06-20T14:00:00.000Z".
  @IsISO8601()
  startTime!: string;

  // Optionally assign directly to a staff member (must have the skill & be free).
  @IsOptional()
  @IsString()
  staffId?: string;

  // The customer's preferred technician (stored as a preference when unassigned).
  @IsOptional()
  @IsString()
  preferredStaffId?: string;

  // End-customer details (a Customer row is found or created within the tenant).
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  customerFirstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerLastName?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  // Optional birthday (YYYY-MM-DD) the customer may share when booking — used only
  // to send a birthday greeting/offer later. Never required to book.
  @IsOptional()
  @IsString()
  @MaxLength(10)
  customerBirthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // Explicit opt-in for promotional SMS (A2P 10DLC). Optional and OFF by default;
  // never required to book. Stored on the Customer; transactional reminders do
  // not depend on it.
  @IsOptional()
  @IsBoolean()
  smsConsent?: boolean;

  // Optional referral code (from a /book/:slug?ref=CODE link). Attributes a NEW
  // customer to whoever referred them; ignored for returning customers.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  referralCode?: string;

  // Optional: when set on the public booking flow, a payment is created right
  // after the booking (PAY_ONLINE charges via the mock provider; PAY_LATER is
  // recorded PENDING). Ignored by the admin create flow.
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;
}
