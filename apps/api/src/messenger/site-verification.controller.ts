import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';

/**
 * Proves to Zalo that this host is ours.
 *
 * Zalo will not send an OA admin back to a callback on a domain it has not
 * verified, and it verifies a domain the way search engines do: a tag on
 * the root page, or a file named for the code at the root. The API answers
 * nothing at "/" — everything lives under /api — so until this existed there
 * was nowhere to put the tag, and the one-click connect could not be
 * switched on.
 *
 * The code is public by nature (it is served to anyone who asks) and comes
 * from the environment, so verifying a new host or a new Zalo app is a
 * variable and a restart, not a commit. Both of Zalo's methods are served
 * from the same value; the person picks whichever the console offers.
 *
 * These two routes are the ONLY ones outside /api — see main.ts, where they
 * are excluded from the global prefix by name.
 */
@SkipRateLimit()
@Controller()
export class SiteVerificationController {
  private code(): string {
    return (process.env.ZALO_SITE_VERIFICATION || '').trim();
  }

  /** The root page: a tag in the head, and a line that says what this host is. */
  @Public()
  @Get('/')
  root(@Res() res: Response) {
    const code = this.code();
    const tag = code ? `<meta name="zalo-platform-site-verification" content="${escapeAttr(code)}" />` : '';
    res.type('html').send(
      `<!doctype html><html><head><meta charset="utf-8"><title>Lumio API</title>${tag}</head>`
      + '<body style="font-family:system-ui;color:#334155;padding:32px">Lumio Booking API — see <code>/api/health</code>.</body></html>',
    );
  }

  /** zalo_verifier<code>.html — the file method. Served only for the code we hold. */
  @Public()
  @Get('zalo_verifier*')
  verifier(@Req() req: Request, @Res() res: Response) {
    const code = this.code();
    const m = /^\/zalo_verifier([A-Za-z0-9_-]+)\.html$/.exec(req.path);
    if (!code || !m || m[1] !== code) { res.status(404).send('Not found'); return; }
    res.type('html').send(code);
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
