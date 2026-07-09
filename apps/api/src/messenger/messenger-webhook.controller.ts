import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MessengerService } from './messenger.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { verifyMetaSignature } from '../common/security/webhook-signatures';

/**
 * Public Meta Messenger webhook. GET verifies the subscription (hub.challenge);
 * POST receives message events. No @Roles so the RolesGuard won't block Meta.
 * @SkipRateLimit: Meta batches many message events to one endpoint from one IP.
 */
@SkipRateLimit()
@Controller('messenger')
export class MessengerWebhookController {
  constructor(private readonly svc: MessengerService) {}

  @Public()
  @Get('webhook')
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const ok = this.svc.verify(query['hub.mode'] || '', query['hub.verify_token'] || '', query['hub.challenge'] || '');
    if (ok) res.status(200).send(ok);
    else res.status(403).send('Forbidden');
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Body() body: unknown) {
    // Verify Meta's X-Hub-Signature-256 over the raw body. Spoofed events are
    // silently dropped (still 200 so Meta doesn't retry a forged request).
    if (verifyMetaSignature(req)) {
      this.svc.handleWebhook(body).catch(() => undefined);
    }
    return 'EVENT_RECEIVED';
  }

  /**
   * Facebook Login for Business redirect target. Meta sends the salon admin back
   * here with ?code&state after they pick their Page; we exchange the code and
   * bounce them to the salon Messenger settings page. Public because Meta calls it
   * without our JWT — the signed `state` proves which tenant started the flow.
   */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const url = await this.svc.oauthCallback(code || '', state || '', error || '');
    res.redirect(url);
  }

  /**
   * Facebook "Data Deletion Request" callback (App Review requirement). Meta POSTs
   * a form-encoded signed_request when a user asks to delete their data; we remove
   * their conversation data and return { url, confirmation_code }.
   */
  @Public()
  @Post('data-deletion')
  @HttpCode(200)
  dataDeletion(@Body('signed_request') signedRequest: string) {
    return this.svc.dataDeletion(signedRequest || '');
  }
}
