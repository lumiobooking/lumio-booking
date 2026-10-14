import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { OAuthGate, tenantOfState } from '../common/oauth-gate.service';
import { Response } from 'express';
import { SettingsService } from './settings.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public Google OAuth callback (Google redirects the browser here with ?code).
 * Kept in its own controller WITHOUT class-level @Roles so it isn't blocked by
 * the RolesGuard — the request carries no logged-in user, only a signed state.
 */
@Controller('settings')
export class GmailOAuthController {
  constructor(private readonly settings: SettingsService, private readonly gate: OAuthGate) {}

  @Public()
  @Get('gmail/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    // The grant is applied only from the salon's own signed-in session (common/oauth-gate.service.ts).
    const parked = await this.gate.park('gmail', tenantOfState(this.settings, state ?? ''), { code: code ?? '', state: state ?? '' });
    res.redirect(parked ?? await this.settings.gmailCallback(code ?? '', state ?? ''));
  }

  /** /oauth/confirm on the web, signed in: apply the parked Gmail grant to THIS salon. */
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  @Post('gmail/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: { n?: string; c?: string }) {
    const q = await this.gate.claim(user, 'gmail', String(dto?.n ?? ''), String(dto?.c ?? ''));
    return { redirect: await this.settings.gmailCallback(q.code || '', q.state || '') };
  }
}
