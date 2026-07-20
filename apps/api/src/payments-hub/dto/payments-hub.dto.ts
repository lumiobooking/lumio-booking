import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export const PROVIDERS = ['stripe', 'mock', 'square', 'sumup', 'adyen'] as const;

export class ConnectDto {
  @IsString() @IsIn(PROVIDERS as unknown as string[]) provider!: string;
  @IsString() secret!: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() currency?: string;
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
