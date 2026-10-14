import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { OAuthGate, tenantOfState } from '../common/oauth-gate.service';
import { Response } from 'express';
import { GoogleReviewsService } from './google-reviews.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public Google OAuth callback (Google redirects the browser here with ?code).
 * Kept in its own controller WITHOUT class-level @Roles so the RolesGuard won't
 * block it — the request carries no logged-in user, only a signed state token.
 */
@Controller('google-reviews')
export class GoogleReviewsOAuthController {
  constructor(private readonly svc: GoogleReviewsService, private readonly gate: OAuthGate) {}

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    // The grant is applied only from the salon's own signed-in session (common/oauth-gate.service.ts).
    const parked = await this.gate.park('google', tenantOfState(this.svc, state ?? ''), { code: code ?? '', state: state ?? '' });
    res.redirect(parked ?? await this.svc.callback(code ?? '', state ?? ''));
  }

  /** /oauth/confirm on the web, signed in: apply the parked Google grant to THIS salon. */
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  @Post('oauth/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: { n?: string; c?: string }) {
    const q = await this.gate.claim(user, 'google', String(dto?.n ?? ''), String(dto?.c ?? ''));
    return { redirect: await this.svc.callback(q.code || '', q.state || '') };
  }
}
