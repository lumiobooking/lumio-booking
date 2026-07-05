import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Salon Admin: edit their own AI hotline behaviour (never the assigned number). */
export class UpdateVoiceDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsString() @MaxLength(12) language?: string;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;
}

/** Super Admin: assign a Lumio-owned voice number to a tenant. */
export class ProvisionVoiceDto {
  @IsString() tenantId!: string;
  @IsString() lumioNumber!: string;
}

/** Super Admin: set a tenant's AI plan limits (0 = unlimited; overage in cents). */
export class VoiceLimitsDto {
  @IsString() tenantId!: string;
  @IsOptional() @IsInt() @Min(0) includedMinutes?: number;
  @IsOptional() @IsInt() @Min(0) includedSms?: number;
  @IsOptional() @IsInt() @Min(0) overageCentsPerMin?: number;
  @IsOptional() @IsInt() @Min(0) overageCentsPerSms?: number;
  @IsOptional() @IsBoolean() hardCap?: boolean;
}
