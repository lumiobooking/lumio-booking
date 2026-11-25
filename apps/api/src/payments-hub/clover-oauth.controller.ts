import { Controller, Get, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CloverOAuthService } from './clover-oauth.service';

/**
 * rt233 — "Connect with Clover". The salon owner asks for the sign-in link
 * (their own salon only); Clover's redirect comes back to the public callback,
 * which trusts nothing but the signed, short-lived state it carries.
 */
@Controller('payments-hub/clover')
export class CloverOAuthController {
  constructor(private readonly clover: CloverOAuthService) {}

  @Get('available')
  @Roles(UserRole.SALON_ADMIN, UserRole.STAFF, UserRole.SUPER_ADMIN)
  available() { return { available: this.clover.available() }; }

  @Get('connect')
  @Roles(UserRole.SALON_ADMIN, UserRole.SUPER_ADMIN)
  connect(@CurrentUser() user: AuthenticatedUser) { return this.clover.connectUrl(user); }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('merchant_id') merchantId: string, @Query('state') state: string, @Res() res: Response) {
    res.redirect(await this.clover.callback(code ?? '', merchantId ?? '', state ?? ''));
  }
}
