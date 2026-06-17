import { BadRequestException, Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { BillingService } from './billing.service';

class SignupDto {
  @IsString() salonName!: string;
  @IsString() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() planId!: string;
  @IsIn(['month', 'year']) interval!: 'month' | 'year';
  @IsIn(['stripe', 'paypal']) provider!: 'stripe' | 'paypal';
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Public pricing page data. */
  @Public()
  @Get('public/plans')
  plans() {
    return this.billing.publicPlans();
  }

  /** Public self-serve signup → returns the provider checkout URL. */
  @Public()
  @Post('public/signup')
  signup(@Body() dto: SignupDto) {
    return this.billing.signup(dto);
  }

  /** Stripe webhook (signature-verified against the raw body). */
  @Public()
  @Post('billing/webhook/stripe')
  async stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');
    await this.billing.handleStripeWebhook(req.rawBody, sig);
    return { received: true };
  }

  /** PayPal webhook (verified via PayPal's verification endpoint). */
  @Public()
  @Post('billing/webhook/paypal')
  async paypalWebhook(@Req() req: Request, @Body() body: any) {
    await this.billing.handlePaypalWebhook(req.headers as Record<string, string | undefined>, body);
    return { received: true };
  }
}
