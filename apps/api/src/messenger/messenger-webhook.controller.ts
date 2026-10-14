import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MessengerService } from './messenger.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { verifyMetaSignature } from '../common/security/webhook-signatures';
import { OAuthGate, tenantOfState } from '../common/oauth-gate.service';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * Public Meta Messenger webhook. GET verifies the subscription (hub.challenge);
 * POST receives message events. No @Roles so the RolesGuard won't block Meta.
 * @SkipRateLimit: Meta batches many message events to one endpoint from one IP.
 */
@SkipRateLimit()
@Controller('messenger')
export class MessengerWebhookController {
  constructor(private readonly svc: MessengerService, private readonly gate: OAuthGate) {}

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
    } else {
      // Counted, so the status page can say "Meta is sending, but from another
      // app" instead of looking identical to "Meta is not sending at all".
      this.svc.noteRejectedWebhook();
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
    // The grant is applied only from the salon's own signed-in session (common/oauth-gate.service.ts).
    const parked = error ? null : await this.gate.park('facebook', tenantOfState(this.svc, state || ''), { code: code || '', state: state || '' });
    res.redirect(parked ?? await this.svc.oauthCallback(code || '', state || '', error || ''));
  }

  /** /oauth/confirm on the web, signed in: apply the parked Facebook grant to THIS salon. */
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  @Post('oauth/confirm')
  @HttpCode(200)
  async oauthConfirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: { n?: string; c?: string }) {
    const q = await this.gate.claim(user, 'facebook', String(dto?.n ?? ''), String(dto?.c ?? ''));
    return { redirect: await this.svc.oauthCallback(q.code || '', q.state || '', '') };
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
