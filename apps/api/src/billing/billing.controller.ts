import { BadRequestException, Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
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

  /** Super Admin: payment gateway connection status + webhook URLs. */
  @Roles(UserRole.SUPER_ADMIN)
  @Get('billing/config')
  gatewayStatus() {
    return this.billing.gatewayStatus();
  }

  /** Super Admin: save Stripe/PayPal keys (blank fields kept). */
  @Roles(UserRole.SUPER_ADMIN)
  @Post('billing/config')
  saveGateways(@Body() dto: Record<string, string | undefined>) {
    return this.billing.saveGateways(dto);
  }

  /** Super Admin: live-test the configured gateways. */
  @Roles(UserRole.SUPER_ADMIN)
  @Get('billing/config/test')
  testGateways() {
    return this.billing.testGateways();
  }

  /** Salon admin: active plans available to upgrade to. */
  @Roles(UserRole.SALON_ADMIN)
  @Get('billing/plans')
  upgradePlans() {
    return this.billing.upgradePlans();
  }

  /** Salon admin: current subscription status + dates. */
  @Roles(UserRole.SALON_ADMIN)
  @Get('billing/status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.subscriptionStatus(user);
  }

  /** Salon admin: subscribe to / upgrade to a plan (checkout for this salon). */
  @Roles(UserRole.SALON_ADMIN)
  @Post('billing/subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: { planId: string; interval: 'month' | 'year'; provider?: 'stripe' | 'paypal' }) {
    return this.billing.subscribeExisting(user, dto);
  }

  /** Salon admin: open the Stripe Billing Portal to manage/cancel/update card. */
  @Roles(UserRole.SALON_ADMIN)
  @Post('billing/portal')
  portal(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.billingPortal(user);
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
