import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { PinterestConnectService } from './pinterest-connect.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../auth/decorators/public.decorator';

/**
 * The Super Admin's side of the Pinterest connection: see it, start it, end
 * it. The callback is public because Pinterest's redirect carries no login
 * — only the signed state proves it was us who started it (the Drive and
 * TikTok callbacks work the same way).
 */
@Controller('content/pinterest')
export class PinterestController {
  constructor(private readonly pin: PinterestConnectService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get('status')
  status() {
    return this.pin.status();
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get('connect')
  connect() {
    return this.pin.authUrl();
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    res.redirect(await this.pin.callback(code ?? '', state ?? '', error || undefined));
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post('disconnect')
  @HttpCode(200)
  async disconnect() {
    await this.pin.disconnect();
    return { ok: true };
  }
}
