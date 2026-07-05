import { Body, Controller, Header, HttpCode, Post, Query } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public Twilio Voice webhooks for the AI hotline. Twilio POSTs form-encoded
 * call data and expects a TwiML (XML) response. No @Roles so the RolesGuard
 * won't block Twilio; the tenant is resolved from the dialed Lumio number.
 */
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
}
