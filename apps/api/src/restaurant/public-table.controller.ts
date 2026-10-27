import { Body, Controller, Get, Headers, HttpCode, Param, Post, Sse } from '@nestjs/common';
import { Observable, catchError, debounceTime, distinctUntilChanged, filter, from, interval, map, merge, of, skip, startWith, switchMap } from 'rxjs';
import { liveEvents } from '../common/live-events';
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

  /**
   * The guest's phone keeps this open: a nudge the moment THIS table changes
   * (the staff accepted the QR order, the kitchen started or finished a dish,
   * a dish sold out), so the screen does not wait for its next poll. Topic
   * and time only; the phone then reads its own table as before.
   */
  @RateLimit(30, 60_000)
  @Sse('table/:token/stream')
  stream(@Param('token') token: string): Observable<MessageEvent> {
    const stamp = () => from(this.svc.guestStamp(token)).pipe(catchError(() => of(null)));
    return from(this.svc.guestStreamTenant(token)).pipe(
      switchMap((tenantId) => stamp().pipe(switchMap((first) => merge(
        liveEvents.stream(tenantId).pipe(
          filter((e) => e.topic === 'restaurant' || e.topic === 'orders'),
          debounceTime(250),
          switchMap(() => stamp()),
          filter((x): x is string => typeof x === 'string'),
          startWith(first),
          distinctUntilChanged(),
          skip(1),
          map(() => ({ data: { topic: 'table', at: Date.now() } } as MessageEvent)),
        ),
        interval(25_000).pipe(map(() => ({ data: { topic: 'ping', at: Date.now() } } as MessageEvent))),
      )))),
    );
  }

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
