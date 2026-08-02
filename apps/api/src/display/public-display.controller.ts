import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { DisplayService } from './display.service';
import { DisplayTipDto, PairDto, SelfCheckInDto } from './dto/display.dto';

// Device-side endpoints (the wireless iPad). No login: the pairing token IS the
// credential, and the tenant is resolved from it — never from the request body.
@Public()
@Controller('display')
export class PublicDisplayController {
  constructor(private readonly display: DisplayService) {}

  @Post('pair')
  pair(@Body() dto: PairDto) {
    return this.display.pair(dto.pairCode);
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
