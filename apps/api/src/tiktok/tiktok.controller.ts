import { Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { TikTokService } from './tiktok.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * The salon's side: see the connection, start it, end it, re-read what the
 * account allows. Owner only — connecting a client's TikTok is the owner's
 * decision, like connecting their Facebook Page.
 */
@Roles(UserRole.SALON_ADMIN)
@Controller('tiktok')
export class TikTokController {
  constructor(private readonly svc: TikTokService) {}

  @Get()
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.status(user);
  }

  @Get('connect')
  connect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.authUrl(user);
  }

  @Post('disconnect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disconnect(user);
  }

  /** Re-ask TikTok what this account may post (privacy levels, max length). */
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
  constructor(private readonly svc: TikTokService) {}

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const url = await this.svc.callback(code ?? '', state ?? '', error || undefined);
    res.redirect(url);
  }
}
