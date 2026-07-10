import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { HeldBillsService } from './held-bills.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

class CreateHeldBillDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsInt() @Min(0) totalCents?: number;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('pos')
@Controller('pos/held')
export class HeldBillsController {
  constructor(private readonly held: HeldBillsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.held.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateHeldBillDto) {
    return this.held.create(user, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.held.remove(user, id);
  }
}
