import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MaxLength(255) website?: string;
}

/**
 * Booking rules. businessHours/daysOff use loose array validation (this is a
 * SALON_ADMIN-only endpoint and the service re-shapes/merges defensively).
 */
export class UpdateBookingRulesDto {
  @IsOptional() @IsInt() @Min(5) @Max(120) slotStepMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(168) minLeadHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) maxAdvanceDays?: number;
  @IsOptional() @IsBoolean() allowCustomerChooseStaff?: boolean;
  @IsOptional() @IsIn(['none', 'auto']) assignmentMode?: 'none' | 'auto';
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsBoolean() onlinePaymentEnabled?: boolean;
  @IsOptional() @IsBoolean() payLaterEnabled?: boolean;
  @IsOptional() @IsArray() businessHours?: unknown[];
  @IsOptional() @IsArray() @IsString({ each: true }) daysOff?: string[];
}

export class UpdateBrandingDto {
  @IsOptional() @IsHexColor() accentColor?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
}

/**
 * Payment configuration. `gateways` is a loose object (validated/merged in the
 * service) so adding a new gateway never requires a DTO change.
 */
export class UpdateNotificationsDto {
  @IsOptional() @IsIn(['off', 'smtp', 'brevo']) mailService?: 'off' | 'smtp' | 'brevo';
  @IsOptional() @IsString() @MaxLength(160) replyTo?: string;
  @IsOptional() @IsString() @MaxLength(120) senderName?: string;
  @IsOptional() @IsString() @MaxLength(160) senderEmail?: string;
  @IsOptional() @IsString() @MaxLength(160) adminEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) adminPhone?: string;
  @IsOptional() @IsBoolean() emailCustomerOnBooking?: boolean;
  @IsOptional() @IsBoolean() emailAdminOnBooking?: boolean;
  @IsOptional() @IsBoolean() smsCustomerOnBooking?: boolean;
  @IsOptional() @IsBoolean() smsAdminOnBooking?: boolean;
  @IsOptional() @IsString() @MaxLength(200) emailSubjectCustomer?: string;
  @IsOptional() @IsString() @MaxLength(2000) emailIntroCustomer?: string;
  @IsOptional() @IsString() @MaxLength(200) emailSubjectAdmin?: string;
  @IsOptional() @IsString() @MaxLength(2000) emailIntroAdmin?: string;
  @IsOptional() @IsString() @MaxLength(2000) emailFooter?: string;
  @IsOptional() @IsString() @MaxLength(320) smsCustomer?: string;
  @IsOptional() @IsString() @MaxLength(320) smsAdmin?: string;
  @IsOptional() @IsObject() smtp?: Record<string, unknown>;
  @IsOptional() @IsObject() brevo?: Record<string, unknown>;
  @IsOptional() @IsObject() twilio?: Record<string, unknown>;
}

export class UpdatePaymentsDto {
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(6) currencySymbol?: string;
  @IsOptional() @IsIn(['before', 'after']) symbolPosition?: 'before' | 'after';
  @IsOptional() @IsInt() @Min(0) @Max(3) priceDecimals?: number;
  @IsOptional() @IsIn(['online', 'onsite']) defaultPaymentMethod?: 'online' | 'onsite';
  @IsOptional() @IsBoolean() onSiteEnabled?: boolean;
  @IsOptional() @IsObject() gateways?: Record<string, unknown>;
}
