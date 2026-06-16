import { Controller, Delete, Get, Param } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CustomersService } from './customers.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

@Roles(UserRole.SALON_ADMIN)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.customers.list(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.getById(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.remove(user, id);
  }
}
