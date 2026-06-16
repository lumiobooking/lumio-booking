import { Controller, Get, Query, Res } from '@nestjs/common';
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
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('gmail/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const url = await this.settings.gmailCallback(code ?? '', state ?? '');
    res.redirect(url);
  }
}
