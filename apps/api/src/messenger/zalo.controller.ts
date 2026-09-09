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

/** Salon-admin management of the Zalo OA mouth. Same trust boundary as
 *  connecting a Facebook Page: configuration is the owner's job. */
@Roles(UserRole.SALON_ADMIN)
@Controller('zalo')
export class ZaloController {
  constructor(private readonly svc: ZaloOaService) {}

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
  constructor(private readonly svc: ZaloOaService) {}

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
    const url = await this.svc.oauthCallback(code || '', oaId || '', state || '');
    res.redirect(url);
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
