import {
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
import { CreateOrderDto, CreateProductDto, UpdateProductDto } from './dto/pos.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  // ---- Products ----
  @Get('products')
  listProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.listProducts(user);
  }

  @Post('products')
  createProduct(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.pos.createProduct(user, dto);
  }

  @Patch('products/:id')
  updateProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.pos.updateProduct(user, id, dto);
  }

  @Delete('products/:id')
  removeProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.removeProduct(user, id);
  }

  // ---- Reports ----
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
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.pos.createOrder(user, dto);
  }

  @Post('orders/:id/void')
  @HttpCode(200)
  voidOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.pos.voidOrder(user, id);
  }
}
