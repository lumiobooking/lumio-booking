import { Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { GoogleDriveService } from './google-drive.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * The Super Admin's side of the Drive archive: connect once, see where it
 * points, disconnect. The callback is public because Google's redirect
 * carries no login — only the signed state proves it was us who started it.
 */
@Controller('storage/gdrive')
export class GoogleDriveController {
  constructor(private readonly drive: GoogleDriveService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get('status')
  status() {
    return this.drive.status();
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get('auth-url')
  authUrl() {
    return this.drive.authUrl();
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    res.redirect(await this.drive.callback(code ?? '', state ?? ''));
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post('disconnect')
  @HttpCode(200)
  async disconnect() {
    await this.drive.disconnect();
    return { ok: true };
  }
}
