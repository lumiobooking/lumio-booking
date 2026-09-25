import { Body, Controller, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { SkipRateLimit } from '../common/security/rate-limit.guard';
import { TwilioSignatureGuard } from '../common/security/webhook-signatures';
import { NotificationsService } from './notifications.service';

/**
 * Texts customers send BACK to a Lumio Twilio number.
 *
 * In the US and Canada Twilio enforces STOP itself. Outside North America it
 * does not, and Australia's Spam Act requires an unsubscribe that actually
 * works — so each +61 number's "A message comes in" webhook points here, and
 * an opt-out word clears marketing consent for that customer at that salon.
 * Booking confirmations and reminders keep going: refusing adverts is not
 * refusing your own appointment.
 *
 * Signed by Twilio (same guard as the voice webhooks) and answered with empty
 * TwiML, so Twilio sends no automatic reply of its own.
 */
@SkipRateLimit()
@UseGuards(TwilioSignatureGuard)
@Controller('public/twilio')
export class TwilioInboundController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Post('sms')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  async sms(@Body() body: Record<string, string>) {
    await this.notifications.handleInboundSms(body ?? {}).catch(() => undefined);
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
}
