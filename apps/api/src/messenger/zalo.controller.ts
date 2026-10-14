import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ZaloOaService } from './zalo-oa.service';
import { OAuthGate, tenantOfState } from '../common/oauth-gate.service';

/** Salon-admin management of the Zalo OA mouth. Same trust boundary as
 *  connecting a Facebook Page: configuration is the owner's job. */
@Roles(UserRole.SALON_ADMIN)
@Controller('zalo')
export class ZaloController {
  constructor(private readonly svc: ZaloOaService, private readonly gate: OAuthGate) {}

  /** /oauth/confirm on the web, signed in: apply the parked Zalo grant to THIS salon. */
  @Post('oauth/confirm')
  @HttpCode(200)
  async oauthConfirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: { n?: string; c?: string }) {
    const q = await this.gate.claim(user, 'zalo', String(dto?.n ?? ''), String(dto?.c ?? ''));
    return { redirect: await this.svc.oauthCallback(q.code || '', q.oa_id || '', q.state || '') };
  }

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  /** The one-click path: the link the "Kết nối Zalo OA" button opens. */
  @Get('oauth/url')
  oauthUrl(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.oauthUrl(user);
  }

  /** The console path, kept for an app that is not Lumio's. */
  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser, @Body() dto: Record<string, string>) {
    return this.svc.connect(user, dto ?? {});
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disconnect(user);
  }
}

/**
 * Public Zalo OA webhook. Zalo POSTs events here; a GET answers 200 so the
 * console's reachability check passes. Signature verification lives in the
 * service (it needs the tenant's own OA secret), and every request is
 * answered 200 — Zalo retries anything else, and a forged event deserves
 * silence, not a hint.
 */
@SkipRateLimit()
@Controller('public/zalo')
export class ZaloWebhookController {
  constructor(private readonly svc: ZaloOaService, private readonly gate: OAuthGate) {}

  @Public()
  @Get('webhook')
  verify() {
    return 'OK';
  }

  /**
   * Zalo sends the OA admin back here after Đồng ý. Public because Zalo
   * calls it without our JWT — the signed `state` proves which salon
   * started the flow, and the PKCE verifier proves it is the same browser.
   */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('oa_id') oaId: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    // The grant is applied only from the salon's own signed-in session (common/oauth-gate.service.ts).
    const parked = await this.gate.park('zalo', tenantOfState(this.svc, state || ''), { code: code || '', oa_id: oaId || '', state: state || '' });
    res.redirect(parked ?? await this.svc.oauthCallback(code || '', oaId || '', state || ''));
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? null);
    const sig = String(req.headers['x-zevent-signature'] ?? '');
    this.svc.handleWebhook(raw, sig || undefined).catch(() => undefined);
    return 'EVENT_RECEIVED';
  }
}
