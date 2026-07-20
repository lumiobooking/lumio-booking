import { BadRequestException, Controller, Headers, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { PaymentOrchestrator } from './payment-orchestrator.service';

/**
 * Per-tenant provider webhook. The salon configures this URL in THEIR OWN
 * provider dashboard with THEIR signing secret; we verify against the secret
 * stored for that tenant+provider. tenantId is in the path so we can pick the
 * right key before verifying (BYO model — no shared platform secret).
 */
@Controller('payments-hub')
export class PaymentsHubWebhookController {
  constructor(private readonly hub: PaymentOrchestrator) {}

  @Public()
  @SkipRateLimit()
  @Post('webhook/:provider/:tenantId')
  async webhook(
    @Param('provider') provider: string,
    @Param('tenantId') tenantId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') stripeSig?: string,
  ) {
    if (!req.rawBody) throw new BadRequestException('Missing raw body');
    const signature = stripeSig ?? (req.headers['x-signature'] as string) ?? '';
    return this.hub.handleWebhook(provider, tenantId, req.rawBody, signature);
  }
}
