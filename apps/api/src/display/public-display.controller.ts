import { Body, Controller, Get, Param, Post, Sse } from '@nestjs/common';
import { Observable, filter, from, interval, map, merge, switchMap } from 'rxjs';
import { liveEvents } from '../common/live-events';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/security/rate-limit.guard';
import { DisplayService } from './display.service';
import { DisplayTipDto, PairDto, SelfCheckInDto } from './dto/display.dto';

// Device-side endpoints (the wireless iPad). No login: the pairing token IS the
// credential, and the tenant is resolved from it — never from the request body.
@Public()
@Controller('display')
export class PublicDisplayController {
  constructor(private readonly display: DisplayService) {}

  // Six characters from 32: fine for a person, not for a script — ten tries a minute per address.
  @RateLimit(10, 60_000)
  @Post('pair')
  pair(@Body() dto: PairDto) {
    return this.display.pair(dto.pairCode);
  }

  /**
   * The register changed what the customer should see: a nudge so the iPad
   * reads /state NOW instead of on its next poll. Only the 'display' topic of
   * the token's own salon; no data on the line.
   */
  @Sse('stream/:token')
  stream(@Param('token') token: string): Observable<MessageEvent> {
    return from(this.display.streamTenant(token)).pipe(
      switchMap((tenantId) => merge(
        liveEvents.stream(tenantId).pipe(filter((e) => e.topic === 'display'), map((e) => ({ data: { topic: e.topic, at: e.at } } as MessageEvent))),
        interval(25_000).pipe(map(() => ({ data: { topic: 'ping', at: Date.now() } } as MessageEvent))),
      )),
    );
  }

  @Get('state/:token')
  state(@Param('token') token: string) {
    return this.display.stateByToken(token);
  }

  // Kiosk mode: the salon's menu, then the customer's own check-in.
  @Get('checkin-menu/:token')
  checkInMenu(@Param('token') token: string) {
    return this.display.checkInMenu(token);
  }

  @Post('checkin/:token')
  selfCheckIn(@Param('token') token: string, @Body() dto: SelfCheckInDto) {
    return this.display.selfCheckIn(token, dto);
  }

  @Post('tip/:token')
  tip(@Param('token') token: string, @Body() dto: DisplayTipDto) {
    return this.display.recordTip(token, dto.amountCents);
  }
}
