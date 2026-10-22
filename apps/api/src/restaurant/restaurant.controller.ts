import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { RestaurantService } from './restaurant.service';
import {
  AcceptQrDto, AddLineDto, BankFeedDto, HoldDto, MergeCheckDto, ReadyDto, SendDto, MoveCheckDto, OpenCheckDto, PayCheckDto, PrebillDto, SaveRestaurantSettingsDto, SoldOutDto, SplitCheckDto,
  UpdateCheckDto, UpdateLineDto, VoidCheckDto, VoidLineDto,
} from './dto/restaurant.dto';

/**
 * Table service (restaurants): the till and the servers' phones. Everyone
 * who may use the till (`pos`) can open tables, order and send to the kitchen;
 * taking back a sent dish follows the restaurant's approval rule; only the
 * owner changes the stations. All routes are tenant-scoped in the service.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly svc: RestaurantService) {}

  @Get('floor')
  floor(@CurrentUser() user: AuthenticatedUser) { return this.svc.floor(user); }

  @Caps('pos', 'kitchen')
  @Get('menu')
  menu(@CurrentUser() user: AuthenticatedUser) { return this.svc.menu(user); }

  @Caps('pos', 'kitchen')
  @Post('menu/:itemId/sold-out')
  soldOut(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string, @Body() dto: SoldOutDto) { return this.svc.setSoldOut(user, itemId, dto.soldOut); }

  @Roles(UserRole.SALON_ADMIN)
  @Get('people')
  people(@CurrentUser() user: AuthenticatedUser) { return this.svc.people(user); }

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) { return this.svc.readSettings(user); }

  @Roles(UserRole.SALON_ADMIN)
  @Patch('settings')
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveRestaurantSettingsDto) { return this.svc.saveSettings(user, dto.settings); }

  @Get('prints/failed')
  failedPrints(@CurrentUser() user: AuthenticatedUser) { return this.svc.failedPrints(user); }

  @Post('prints/:jobId/retry')
  reprint(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) { return this.svc.reprint(user, jobId); }

  @Post('checks')
  open(@CurrentUser() user: AuthenticatedUser, @Body() dto: OpenCheckDto) { return this.svc.openCheck(user, dto); }

  @Get('checks/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.getCheck(user, id); }

  @Patch('checks/:id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCheckDto) { return this.svc.updateCheck(user, id, dto); }

  @Post('checks/:id/lines')
  addLine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddLineDto) { return this.svc.addLine(user, id, dto); }

  @Patch('checks/:id/lines/:lineId')
  updateLine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: UpdateLineDto) {
    return this.svc.updateLine(user, id, lineId, dto);
  }

  @Delete('checks/:id/lines/:lineId')
  removeLine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.svc.removeLine(user, id, lineId);
  }

  @Post('checks/:id/send')
  send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SendDto) { return this.svc.send(user, id, { held: dto?.held === true }); }

  @Patch('checks/:id/lines/:lineId/hold')
  hold(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: HoldDto) { return this.svc.setHold(user, id, lineId, dto.held); }

  @Post('checks/:id/accept-qr')
  acceptQr(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AcceptQrDto) { return this.svc.acceptQr(user, id, dto?.send !== false); }

  @Post('checks/:id/reject-qr')
  rejectQr(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.rejectQr(user, id); }

  @Post('checks/:id/clear-call')
  clearCall(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.clearCall(user, id); }

  @Caps('pos', 'kitchen')
  @Get('kitchen')
  kitchen(@CurrentUser() user: AuthenticatedUser, @Query('station') station?: string) { return this.svc.kitchen(user, station); }

  @Caps('pos', 'kitchen')
  @Post('kitchen/ready')
  ready(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReadyDto) { return this.svc.markReady(user, dto.lineIds, dto.ready !== false); }

  @Roles(UserRole.SALON_ADMIN)
  @Get('qr-codes')
  qrCodes(@CurrentUser() user: AuthenticatedUser) { return this.svc.qrCodes(user); }

  @Roles(UserRole.SALON_ADMIN)
  @Post('tables/:tableId/qr-reset')
  resetQr(@CurrentUser() user: AuthenticatedUser, @Param('tableId') tableId: string) { return this.svc.resetQr(user, tableId); }

  @Roles(UserRole.SALON_ADMIN)
  @Get('bank-feed')
  bankFeed(@CurrentUser() user: AuthenticatedUser) { return this.svc.bankFeed(user); }

  @Roles(UserRole.SALON_ADMIN)
  @Post('bank-feed')
  setupBankFeed(@CurrentUser() user: AuthenticatedUser, @Body() dto: BankFeedDto) { return this.svc.setupBankFeed(user, dto.provider); }

  @Post('checks/:id/lines/:lineId/void')
  voidLine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: VoidLineDto) {
    return this.svc.voidLine(user, id, lineId, dto);
  }

  @Post('checks/:id/prebill')
  prebill(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PrebillDto) { return this.svc.prebill(user, id, dto); }

  @Post('checks/:id/move')
  move(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: MoveCheckDto) { return this.svc.move(user, id, dto); }

  @Post('checks/:id/void')
  voidCheck(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VoidCheckDto) { return this.svc.voidCheck(user, id, dto); }

  @Post('checks/:id/merge')
  merge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: MergeCheckDto) { return this.svc.merge(user, id, dto); }

  @Post('checks/:id/split')
  split(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SplitCheckDto) { return this.svc.split(user, id, dto); }

  @Post('checks/:id/request-pay')
  requestPay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.svc.requestPay(user, id); }

  @Post('checks/:id/pay')
  pay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PayCheckDto) { return this.svc.pay(user, id, dto); }
}
