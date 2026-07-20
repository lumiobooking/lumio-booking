import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const PROVIDERS = ['stripe', 'mock', 'square', 'sumup', 'adyen'] as const;

export class ConnectDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsString() secret!: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() label?: string;
}

export class RegisterReaderDto {
  @IsString() code!: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() locationId?: string;
}

export class ChargeDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() readerExternalId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsString() clientRef!: string;
  @IsOptional() @IsString() description?: string;
}

export class RefundDto {
  @IsString() intentId!: string;
  @IsOptional() @IsInt() @Min(1) amountCents?: number;
  @IsOptional() @IsString() reason?: string;
}

// ---- Relay agents (Bridge / Companion) ----
export const AGENT_KINDS = ['BRIDGE', 'COMPANION'] as const;

export class CreateAgentDto {
  @IsString() @IsIn(AGENT_KINDS as unknown as string[]) kind!: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() locationId?: string;
}

export class AgentPairDto {
  @IsString() pairingCode!: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() label?: string;
}

export class AgentResultDto {
  @IsString() intentId!: string;
  @IsString() @IsIn(['SUCCEEDED', 'FAILED', 'CANCELED']) status!: string;
  @IsOptional() @IsString() providerReference?: string;
  @IsOptional() @IsString() error?: string;
}

export class AgentRegisterReaderDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsString() externalReaderId!: string;
  @IsOptional() @IsString() label?: string;
}
