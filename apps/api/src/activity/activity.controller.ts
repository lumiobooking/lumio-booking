import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { ActivityService } from './activity.service';

/**
 * GET /api/activity -> recent booking / cancellation / payment events for the
 * authenticated salon (in-app notification feed). Tenant-scoped: the tenantId
 * comes from the signed JWT, never from the client.
 */
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return [];
    return this.activity.feed(tenantId);
  }
}
