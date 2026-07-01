import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { DisplayService } from './display.service';
import { DisplayTipDto, PairDto } from './dto/display.dto';

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

  @Post('tip/:token')
  tip(@Param('token') token: string, @Body() dto: DisplayTipDto) {
    return this.display.recordTip(token, dto.amountCents);
  }
}
