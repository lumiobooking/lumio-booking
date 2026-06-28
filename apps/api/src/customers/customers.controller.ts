import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsEmail, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CustomersService } from './customers.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Caps } from '../auth/decorators/caps.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

class UpdateCustomerDto {
  // birthDate accepts an ISO date string or null to clear it.
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601() birthDate?: string | null;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(80) lastName?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsEmail() email?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(2000) notes?: string | null;
}

class CreateCustomerDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Caps('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.list(user);
  }

  // NOTE: declared before ':id' so "/customers/search" isn't captured as an id.
  @Get('search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') q: string) {
    return this.customers.search(user, q ?? '');
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customers.quickCreate(user, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.getById(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.remove(user, id);
  }
}
