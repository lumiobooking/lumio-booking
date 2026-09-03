import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { NotificationsService } from './notifications.service';

/**
 * Where eSMS reports what actually happened to a message.
 *
 * Sending returned CodeResult 100 — "we accepted it" — and nothing more. The
 * delivery truth arrives here: eSMS calls the CallbackUrl we attach to every
 * send with an HTTPS GET whose query string carries SendStatus and the
 * SendSuccess/SendFailed counters. They retry a failing callback 5 times and
 * then give up forever, so every branch of this endpoint answers 200.
 *
 * Public by necessity (eSMS cannot log in), and safe by construction: the only
 * thing a request can do is settle the delivery status of a row that was
 * really sent through eSMS, matched by the SMSID eSMS itself issued or the
 * RequestId we issued. A forged call can flip a delivery flag on a guessed id
 * at worst — it cannot read anything, and the rate limit prices out guessing.
 */
@Public()
@Controller('public/esms')
export class EsmsCallbackController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The documented shape: GET with query-string parameters. */
  @Get('callback')
  @RateLimit(240, 60_000)
  callbackGet(@Query() q: Record<string, unknown>) {
    return this.notifications.applyEsmsCallback(q ?? {});
  }

  /** Some eSMS products POST JSON instead. Same address, same answer. */
  @Post('callback')
  @RateLimit(240, 60_000)
  callbackPost(@Query() q: Record<string, unknown>, @Body() b: Record<string, unknown>) {
    return this.notifications.applyEsmsCallback({ ...(q ?? {}), ...(b ?? {}) });
  }
}
