import {
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PosService } from './pos.service';
import { SalesImportService } from './sales-import.service';
import { CreateOrderDto, CreateProductDto, RecordTipDto, UpdateProductDto } from './dto/pos.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { hasCapability } from '../auth/capabilities';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService, private readonly salesImport: SalesImportService) {}

  // ---- The printed bill: salon header + the owner's design (any cashier) ----
  @Get('receipt-profile')
  receiptProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.receiptProfile(user);
  }

  /** Money already paid online for the booking(s) on the ticket (deposits). */
  @Get('prepaid')
  prepaid(@CurrentUser() user: AuthenticatedUser, @Query('ids') ids?: string) {
    return this.pos.prepaid(user, ids ?? '');
  }

  // ---- Products ----
  @Get('products')
  listProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.listProducts(user);
  }

  @Caps('products')
  @Post('products')
  createProduct(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.pos.createProduct(user, dto);
  }

  @Caps('products')
  @Patch('products/:id')
  updateProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.pos.updateProduct(user, id, dto);
  }

  @Caps('products')
  @Delete('products/:id')
  removeProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.removeProduct(user, id);
  }

  // ---- Old sales brought in (old system / handwritten book) → owner only ----
  // They land as ordinary paid tickets on their own days, so the sales report,
  // payroll and the dashboard count them (pos/sales-import.ts).
  @Roles(UserRole.SALON_ADMIN)
  @Caps('reports')
  @Post('import-sales/preview')
  @HttpCode(200)
  previewSalesImport(@CurrentUser() user: AuthenticatedUser, @Body() dto: { rows?: unknown; staffMap?: Record<string, string> }) {
    return this.salesImport.preview(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('reports')
  @Post('import-sales')
  importSales(@CurrentUser() user: AuthenticatedUser, @Body() dto: { rows?: unknown; staffMap?: Record<string, string>; label?: string }) {
    return this.salesImport.commit(user, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('reports')
  @Get('import-sales/batches')
  salesImportBatches(@CurrentUser() user: AuthenticatedUser) {
    return this.salesImport.batches(user);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Caps('reports')
  @Delete('import-sales/:batch')
  undoSalesImport(@CurrentUser() user: AuthenticatedUser, @Param('batch') batch: string) {
    return this.salesImport.undo(user, batch);
  }

  // ---- Reports ---- (sales + payroll data → managers/owners only)
  @Caps('reports')
  @Get('report')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pos.report(user, from, to);
  }

  // ---- Orders ----
  @Get('orders')
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.pos.listOrders(user, from, to, status);
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.getOrder(user, id);
  }

  @Post('orders')
  async createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    // A discount typed at the till is the owner's to allow, per person. Promo
    // codes, the menu's own discounts and loyalty points are not "typed" and
    // stay open to anyone who may check out.
    if ((dto.manualDiscountCents ?? 0) > 0 && !hasCapability(user.role, user.staffRole, 'pos.discount', user.staffCaps)) {
      throw new ForbiddenException('You do not have permission to give a discount. Ask the owner or a manager.');
    }
    return this.pos.createOrder(user, dto);
  }

  /** What today still owes the books: served-not-paid, paid-not-credited, bookings left open or completed by hand. */
  @Get('day-check')
  dayCheck(@CurrentUser() user: AuthenticatedUser, @Query('day') day?: string) {
    return this.pos.dayCheck(user, day);
  }

  /** Paid service lines nobody was credited with — the owner's fix-it list (see setLineStaff). */
  @Roles(UserRole.SALON_ADMIN)
  @Get('orders-unassigned')
  unassignedLines(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.pos.unassignedLines(user, from, to);
  }

  /** Change which technician a paid line is credited to. Money untouched; refused inside a finalised payroll. */
  @Roles(UserRole.SALON_ADMIN)
  @Patch('orders/:id/staff')
  setLineStaff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: { items?: { itemId: string; staffMemberId: string | null }[] }) {
    return this.pos.setLineStaff(user, id, Array.isArray(body?.items) ? body.items : []);
  }

  // Voiding or deleting a paid ticket moves money backwards: the owner decides who may.
  @Caps('pos.void')
  @Post('orders/:id/void')
  @HttpCode(200)
  voidOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.voidOrder(user, id);
  }

  @Caps('pos.void')
  @Delete('orders/:id')
  removeOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.removeOrder(user, id);
  }

  // ---- Direct tips (logged only; money goes straight to the tech) ----
  @Post('tips')
  recordTip(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordTipDto) {
    return this.pos.recordTip(user, dto);
  }
}
