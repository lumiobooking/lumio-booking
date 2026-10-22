import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { RestaurantService } from './restaurant.service';
import { GuestCallDto, GuestOrderDto } from './dto/restaurant.dto';

/**
 * No login: a guest at the table (QR code printed per table) and the
 * restaurant's bank feed. The table token and the hook id each name exactly
 * one restaurant; nothing here can read another's data or close a bill.
 */
@Public()
@Controller('public')
export class PublicTableController {
  constructor(private readonly svc: RestaurantService) {}

  @RateLimit(60, 60_000)
  @Get('table/:token')
  menu(@Param('token') token: string) { return this.svc.guestMenu(token); }

  @RateLimit(6, 60_000)
  @Post('table/:token/order')
  order(@Param('token') token: string, @Body() dto: GuestOrderDto) { return this.svc.guestOrder(token, dto); }

  @RateLimit(4, 60_000)
  @Post('table/:token/call')
  call(@Param('token') token: string, @Body() dto: GuestCallDto) { return this.svc.guestCall(token, dto.reason); }

  /** SePay / Casso call this when money lands on the restaurant's account. */
  @RateLimit(120, 60_000)
  @HttpCode(200)
  @Post('bank-feed/:hookId')
  bankFeed(@Param('hookId') hookId: string, @Headers() headers: Record<string, unknown>, @Body() body: unknown) {
    return this.svc.bankWebhook(hookId, headers, body);
  }
}
