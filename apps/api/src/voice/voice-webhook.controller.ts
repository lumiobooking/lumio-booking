import { Body, Controller, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { TwilioSignatureGuard } from '../common/security/webhook-signatures';

/**
 * Public Twilio Voice webhooks for the AI hotline. Twilio POSTs form-encoded
 * call data and expects a TwiML (XML) response. No @Roles so the RolesGuard
 * won't block Twilio; the tenant is resolved from the dialed Lumio number.
 * @SkipRateLimit: Twilio legitimately fires many turns per call from one IP.
 */
@SkipRateLimit()
@UseGuards(TwilioSignatureGuard)
@Controller('voice')
export class VoiceWebhookController {
  constructor(private readonly svc: VoiceService) {}

  /** Configured as the Voice webhook on each Lumio number. First turn. */
  @Public()
  @Post('incoming')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  incoming(@Body() body: Record<string, string>) {
    return this.svc.handleIncoming(body || {});
  }

  /** Each caller utterance (Twilio <Gather> action) comes back here. */
  @Public()
  @Post('turn')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  turn(@Body() body: Record<string, string>, @Query('miss') miss: string) {
    return this.svc.handleTurn(body || {}, miss || '0');
  }

  /** After we ring the salon's own phones: nobody answered / busy → AI or voicemail. */
  @Public()
  @Post('after-dial')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  afterDial(@Body() body: Record<string, string>) {
    return this.svc.handleAfterDial(body || {});
  }

  /** The caller finished leaving a voicemail (Twilio <Record> action). */
  @Public()
  @Post('voicemail')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  voicemail(@Body() body: Record<string, string>) {
    return this.svc.handleVoicemail(body || {});
  }

  /** Twilio "call status changes" callback → records the billed call duration. */
  @Public()
  @Post('status')
  @HttpCode(200)
  status(@Body() body: Record<string, string>) {
    this.svc.handleStatus(body || {}).catch(() => undefined);
    return 'ok';
  }
}
