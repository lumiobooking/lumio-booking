import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { FinanceService } from './finance.service';
import {
  CategoryDto, DrawerCategoryDto, EntryDto, FinanceSettingsDto, FundDto, PayPayrollDto, PayRecurringDto, PayStockDto, RecurringDto, TransferDto, VoidDto,
} from './finance.dto';

/**
 * /finance — Thu & Chi. The salon's money as a whole is the owner's and the
 * manager's to see: the same `reports` capability as the sales reports. The
 * cashier keeps recording drawer money where she always did (pos/shifts).
 * Opening balances, funds and the approval limit are the owner's alone
 * (checked in the service).
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('reports')
@Controller('finance')
export class FinanceController {
  constructor(private readonly svc: FinanceService) {}

  @Get('ledger')
  ledger(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('fundId') fundId?: string) {
    return this.svc.ledger(user, { from, to, fundId });
  }

  @Get('sales-day')
  salesDay(@CurrentUser() user: AuthenticatedUser, @Query('day') day: string, @Query('fundId') fundId: string) {
    return this.svc.salesDay(user, day, fundId);
  }

  @Get('pnl')
  pnl(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string, @Query('cmpFrom') cmpFrom?: string, @Query('cmpTo') cmpTo?: string) {
    return this.svc.pnl(user, { from, to, cmpFrom, cmpTo });
  }

  @Get('trend')
  trend(@CurrentUser() user: AuthenticatedUser, @Query('months') months?: string) {
    return this.svc.trend(user, Number(months ?? 6));
  }

  @Get('pending')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.pending(user);
  }

  @Post('entries')
  createEntry(@CurrentUser() user: AuthenticatedUser, @Body() dto: EntryDto) {
    return this.svc.createEntry(user, dto);
  }

  @Patch('entries/:id')
  updateEntry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EntryDto) {
    return this.svc.updateEntry(user, id, dto);
  }

  @Post('entries/:id/void')
  voidEntry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VoidDto) {
    return this.svc.voidEntry(user, id, dto);
  }

  @Post('transfers')
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransferDto) {
    return this.svc.transfer(user, dto);
  }

  @Post('payroll/:runId/pay')
  payPayroll(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string, @Body() dto: PayPayrollDto) {
    return this.svc.payPayroll(user, runId, dto);
  }

  @Post('stock/:movementId/pay')
  payStock(@CurrentUser() user: AuthenticatedUser, @Param('movementId') movementId: string, @Body() dto: PayStockDto) {
    return this.svc.payStock(user, movementId, dto);
  }

  @Patch('drawer/:movementId')
  categorizeDrawer(@CurrentUser() user: AuthenticatedUser, @Param('movementId') movementId: string, @Body() dto: DrawerCategoryDto) {
    return this.svc.categorizeDrawer(user, movementId, dto);
  }

  @Get('funds')
  funds(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listFunds(user);
  }

  @Post('funds')
  createFund(@CurrentUser() user: AuthenticatedUser, @Body() dto: FundDto) {
    return this.svc.createFund(user, dto);
  }

  @Patch('funds/:id')
  updateFund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: FundDto) {
    return this.svc.updateFund(user, id, dto);
  }

  @Get('categories')
  categories(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listCategories(user);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CategoryDto) {
    return this.svc.createCategory(user, dto);
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CategoryDto) {
    return this.svc.updateCategory(user, id, dto);
  }

  @Get('recurring')
  recurring(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listRecurring(user);
  }

  @Post('recurring')
  createRecurring(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecurringDto) {
    return this.svc.createRecurring(user, dto);
  }

  @Patch('recurring/:id')
  updateRecurring(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RecurringDto) {
    return this.svc.updateRecurring(user, id, dto);
  }

  @Post('recurring/:id/pay')
  payRecurring(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PayRecurringDto) {
    return this.svc.payRecurring(user, id, dto);
  }

  @Post('recurring/:id/skip')
  skipRecurring(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.skipRecurring(user, id);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getSettings(user);
  }

  @Patch('settings')
  saveSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: FinanceSettingsDto) {
    return this.svc.saveSettings(user, dto);
  }
}
