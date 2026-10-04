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
  constructor(private readonly pos: PosService) {}

  // ---- The printed bill: salon header + the owner's design (any cashier) ----
  @Get('receipt-profile')
  receiptProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.receiptProfile(user);
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
