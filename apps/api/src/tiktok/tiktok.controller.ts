import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { TikTokService } from './tiktok.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { OAuthGate, tenantOfState } from '../common/oauth-gate.service';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { RequiresFeature } from '../feature-policy/requires-feature.decorator';

/**
 * The salon's side: see the connection, start it, end it, re-read what the
 * account allows. Owner only — connecting a client's TikTok is the owner's
 * decision, like connecting their Facebook Page.
 */
@Roles(UserRole.SALON_ADMIN)
@Controller('tiktok')
export class TikTokController {
  constructor(private readonly svc: TikTokService, private readonly gate: OAuthGate) {}

  /** /oauth/confirm on the web, signed in: apply the parked TikTok grant to THIS salon. */
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels')
  @Post('oauth/confirm')
  @HttpCode(200)
  async oauthConfirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: { n?: string; c?: string }) {
    const q = await this.gate.claim(user, 'tiktok', String(dto?.n ?? ''), String(dto?.c ?? ''));
    return { redirect: await this.svc.callback(q.code || '', q.state || '', undefined) };
  }

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels')
  @Get('connect')
  connect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.authUrl(user);
  }

  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels')
  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disconnect(user);
  }

  /** Re-ask TikTok what this account may post (privacy levels, max length). */
  @UseGuards(FeaturePolicyGuard)
  @RequiresFeature('channels')
  @Post('creator')
  creator(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.creatorInfo(user);
  }
}

/**
 * Public OAuth callback — TikTok sends the browser here with ?code&state.
 * Its own controller without a class-level @Roles, exactly like the Google
 * one: the request carries no logged-in user, only the signed state.
 */
@Controller('tiktok')
export class TikTokOAuthController {
  constructor(private readonly svc: TikTokService, private readonly gate: OAuthGate) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // The grant is applied only from the salon's own signed-in session (common/oauth-gate.service.ts).
    const parked = error ? null : await this.gate.park('tiktok', tenantOfState(this.svc, state ?? ''), { code: code ?? '', state: state ?? '' });
    res.redirect(parked ?? await this.svc.callback(code ?? '', state ?? '', error || undefined));
  }
}
