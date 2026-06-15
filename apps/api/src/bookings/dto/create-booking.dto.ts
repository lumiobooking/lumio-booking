import {
  IsArray,
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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // Optional: when set on the public booking flow, a payment is created right
  // after the booking (PAY_ONLINE charges via the mock provider; PAY_LATER is
  // recorded PENDING). Ignored by the admin create flow.
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;
}
