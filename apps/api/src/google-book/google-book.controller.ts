import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SUPPORT_ROLE } from '../support/support.service';
import { GoogleBookService, rwgSandbox } from './google-book.service';
import { allowedCountries } from './feed-lint';
import { readSftpEnv } from './sftp-config';

/**
 * The agency's "Google Book button" board. Support and Super Admin only: this
 * is platform work (one feed for every salon), never a salon's own screen.
 */
@Controller('support/google-book')
@Roles(SUPPORT_ROLE, UserRole.SUPER_ADMIN)
export class GoogleBookController {
  constructor(private readonly svc: GoogleBookService) {}

  /** Every live salon: ready / fix (with what to fix) / off, and the last upload. */
  @Get('readiness')
  async readiness() {
    const rows = await this.svc.readiness();
    const sftp = readSftpEnv(process.env);
    return {
      rows, lastRun: this.svc.getLastRun(), lastLinkRun: this.svc.getLastLinkRun(),
      sftpConfigured: Boolean(sftp.config),
      // Never the key — only whether it is set, who logs in, and what is wrong.
      sftp: { host: sftp.host, user: sftp.user, port: sftp.port, dir: sftp.dir, missing: sftp.missing, keyProblem: sftp.keyProblem },
      sandbox: rwgSandbox(process.env),
      countries: allowedCountries(process.env.RWG_COUNTRIES),
      partnerId: process.env.RWG_PARTNER_ID ?? process.env.NEXT_PUBLIC_RWG_PARTNER_ID ?? null,
    };
  }

  /** One salon in detail, optionally re-reading its Google listing. */
  @Get('tenants/:id')
  inspect(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.svc.inspect(id, { refreshProfile: refresh === '1' });
  }

  @Post('tenants/:id/enabled')
  setEnabled(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: { enabled?: boolean }) {
    return this.svc.setEnabled(id, Boolean(body?.enabled), user.userId);
  }

  @Post('tenants/:id/fix-name')
  fixName(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.fixName(id, user.userId);
  }

  @Post('tenants/:id/services/:serviceId/fix-name')
  fixServiceName(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('serviceId') serviceId: string) {
    return this.svc.fixServiceName(id, serviceId, user.userId);
  }

  /** Put (or refresh) this salon's "Book" link on its own Google profile now. */
  @Post('tenants/:id/booking-link')
  bookingLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.syncBookingLink(id, user.userId);
  }

  /** The same for every live salon (it also runs every night). */
  @Post('booking-links/sync')
  syncBookingLinks() {
    return this.svc.syncAllBookingLinks();
  }

  /** Today's six feed files, to download and upload by hand (sandbox, or before SFTP is set up). */
  @Get('feeds')
  feeds() {
    return this.svc.buildFeeds();
  }

  /** Log in to Google's SFTP drop and list it — writes nothing. */
  @Post('sftp-test')
  sftpTest() {
    return this.svc.sftpTest();
  }

  /** Build and upload now, instead of waiting for the nightly run. */
  @Post('run')
  run(@Query('links') links?: string, @Query('withdraw') withdraw?: string) {
    return this.svc.runDaily(new Date(), { links: links !== '0', withdraw: withdraw === '1' });
  }
}
