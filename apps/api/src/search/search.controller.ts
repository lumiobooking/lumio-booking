import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { SearchService } from './search.service';

/** GET /search?q= — the header search. Tenant from the token; results filtered by role. */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) {
    return this.search.search(user, q);
  }
}
