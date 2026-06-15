import { IsEnum, IsString } from 'class-validator';
import { PaymentType } from '@prisma/client';

export class CreatePaymentDto {
  @IsString()
  appointmentId!: string;

  // PAY_ONLINE -> charged immediately via the provider (mock); PAY_LATER ->
  // recorded as PENDING to be settled at the salon.
  @IsEnum(PaymentType)
  type!: PaymentType;
}
