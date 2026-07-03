import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { MessengerService } from './messenger.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public Meta Messenger webhook. GET verifies the subscription (hub.challenge);
 * POST receives message events. No @Roles so the RolesGuard won't block Meta.
 */
@Controller('messenger')
export class MessengerWebhookController {
  constructor(private readonly svc: MessengerService) {}

  @Public()
  @Get('webhook')
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const ok = this.svc.verify(query['hub.mode'] || '', query['hub.verify_token'] || '', query['hub.challenge'] || '');
    if (ok) res.status(200).send(ok);
    else res.status(403).send('Forbidden');
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  receive(@Body() body: unknown) {
    // Acknowledge immediately; process in the background so Meta doesn't retry.
    this.svc.handleWebhook(body).catch(() => undefined);
    return 'EVENT_RECEIVED';
  }
}
