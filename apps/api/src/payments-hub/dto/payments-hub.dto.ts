import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export const PROVIDERS = ['stripe', 'dejavoo', 'helcim', 'mock', 'square', 'sumup', 'adyen'] as const;

export const SPIN_ENVIRONMENTS = ['sandbox', 'production'] as const;

export class ConnectDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsString() secret!: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() label?: string;

  // ---- Dejavoo / iPOSpays (SPIn) ----
  /** Terminal Profile Number of the salon's default terminal. */
  @IsOptional() @IsString() @Length(8, 20) tpn?: string;
  /** Legacy Register ID; upstream marks it obsolete, kept for older setups. */
  @IsOptional() @IsString() @Length(2, 50) registerId?: string;
  /** Which SPIn host to use. Defaults to production. */
  @IsOptional() @IsString() @IsIn(SPIN_ENVIRONMENTS as unknown as string[]) environment?: string;
}

export class RegisterReaderDto {
  /** Dejavoo: the TPN of the terminal being added. Other providers: pairing code. */
  @IsString() code!: string;
  @IsOptional() @IsString() label?: string;
  /** Which salon location this terminal sits at. */
  @IsOptional() @IsString() locationId?: string;
  /**
   * Auth Key belonging to THIS terminal. iPOSpays issues one per TPN, so a
   * second location usually needs its own. Leave blank to reuse the
   * connection-level key.
   */
  @IsOptional() @IsString() authKey?: string;
  @IsOptional() @IsString() registerId?: string;
}

export class ChargeDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() readerExternalId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsString() clientRef!: string;
  /** Tip taken at the POS, charged in the same tap. */
  @IsOptional() @IsInt() @Min(0) tipCents?: number;
  /** Ticket number printed on the terminal receipt. */
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() description?: string;
}

export class VoidDto {
  @IsString() intentId!: string;
  @IsOptional() @IsString() reason?: string;
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
