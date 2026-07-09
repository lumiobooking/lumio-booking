import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/** Constant-time string compare (avoids leaking equality via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * The public base URL Twilio was configured to call. Must match how VoiceService
 * builds its <Gather action> / webhook URLs (apiBase) so the signed URL lines up.
 */
function apiBase(): string {
  return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
}

/**
 * Validates Twilio's `X-Twilio-Signature` on the AI-hotline voice webhooks.
 * Without this, anyone who knows a salon's Lumio number could POST fake call
 * data to create real bookings, send SMS, run the AI agent, and inflate call
 * usage/billing.
 *
 * Verification runs whenever TWILIO_AUTH_TOKEN is set (i.e. the hotline is live).
 * Kill switch: set VOICE_VERIFY_SIGNATURE=false to disable if ever needed.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token || process.env.VOICE_VERIFY_SIGNATURE === 'false') return true; // not configured / kill switch

    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const sig = req.headers?.['x-twilio-signature'];
    if (typeof sig !== 'string' || !sig) throw new ForbiddenException('Missing Twilio signature');

    // Twilio signs: full URL + each POST param (sorted by key) as key+value, no separators.
    const url = apiBase() + (req.originalUrl || req.url || '');
    const body: Record<string, unknown> = req.body && typeof req.body === 'object' ? req.body : {};
    let data = url;
    for (const key of Object.keys(body).sort()) {
      data += key + (body[key] == null ? '' : String(body[key]));
    }
    const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');

    if (!safeEqual(expected, sig)) throw new ForbiddenException('Invalid Twilio signature');
    return true;
  }
}

/**
 * Verifies Meta's `X-Hub-Signature-256` (HMAC-SHA256 of the RAW body with the
 * Facebook app secret) on the Messenger event webhook. Returns true when the app
 * secret isn't configured (dev / not connected) so it never blocks a legit setup.
 * Requires rawBody (enabled globally via NestFactory { rawBody: true }).
 */
export function verifyMetaSignature(req: { headers: Record<string, any>; rawBody?: Buffer }): boolean {
  const secret = process.env.FB_APP_SECRET;
  if (!secret) return true; // app not configured → don't block
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=') || !req.rawBody) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(expected, header);
}
