import { Controller, Get, Query, Res } from '@nestjs/common';
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
  constructor(private readonly svc: GoogleReviewsService) {}

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const url = await this.svc.callback(code ?? '', state ?? '');
    res.redirect(url);
  }
}
