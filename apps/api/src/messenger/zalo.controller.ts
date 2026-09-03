import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
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
