import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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
