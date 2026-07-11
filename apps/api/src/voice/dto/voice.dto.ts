import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Salon Admin: edit their own AI hotline behaviour (never the assigned number). */
export class CustomHourDto {
  @IsInt() @Min(0) @Max(6) day!: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(5) start?: string;
  @IsOptional() @IsString() @MaxLength(5) end?: string;
}

export class UpdateVoiceDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsString() @MaxLength(12) language?: string;
  @IsOptional() @IsString() @MaxLength(2000) aiInstruction?: string;

  // Call routing
  @IsOptional() @IsIn(['ai', 'ring_first', 'forward']) mode?: string;
  @IsOptional() @IsString() @MaxLength(200) forwardNumbers?: string;
  @IsOptional() @IsInt() @Min(5) @Max(60) ringSeconds?: number;

  // When the assistant is allowed to answer
  @IsOptional() @IsIn(['always', 'business_hours', 'after_hours', 'custom']) schedule?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => CustomHourDto)
  customHours?: CustomHourDto[];

  // When nobody (human or AI) is going to answer
  @IsOptional() @IsIn(['voicemail', 'message', 'hangup']) noAnswerAction?: string;
  @IsOptional() @IsString() @MaxLength(500) awayMessage?: string;
  @IsOptional() @IsString() @MaxLength(32) voicemailSms?: string;
}

/** Super Admin: assign a Lumio-owned voice number to a tenant. */
export class ProvisionVoiceDto {
  @IsString() tenantId!: string;
  @IsString() lumioNumber!: string;
}

/** Super Admin: set a tenant's AI plan limits (0 = unlimited; overage in cents). */
export class VoiceLimitsDto {
  @IsString() tenantId!: string;
  @IsOptional() @IsInt() @Min(0) monthlyCents?: number;
  @IsOptional() @IsInt() @Min(0) includedMinutes?: number;
  @IsOptional() @IsInt() @Min(0) includedSms?: number;
  @IsOptional() @IsInt() @Min(0) overageCentsPerMin?: number;
  @IsOptional() @IsInt() @Min(0) overageCentsPerSms?: number;
  @IsOptional() @IsBoolean() hardCap?: boolean;
}
