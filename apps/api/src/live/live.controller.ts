import { Controller, Sse } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Observable, interval, map, merge } from 'rxjs';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { liveEvents } from '../common/live-events';

/**
 * One nudge stream for every live screen of a salon (calendar, POS, restaurant
 * floor, kitchen, orders…): "bookings changed", "restaurant changed". Topic and
 * time only — no ids, no data — so it is safe for any signed-in member of the
 * salon; each screen then reads through its own authorised endpoint. Always
 * the caller's own tenant. A ping every 25 s keeps proxies from closing it.
 */
@Roles(UserRole.SALON_ADMIN, UserRole.STAFF)
@Controller('live')
export class LiveController {
  @Sse('events')
  events(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const tenantId = resolveTenantScope(user) ?? '';
    return merge(
      liveEvents.stream(tenantId).pipe(map((e) => ({ data: { topic: e.topic, at: e.at } } as MessageEvent))),
      interval(25_000).pipe(map(() => ({ data: { topic: 'ping', at: Date.now() } } as MessageEvent))),
    );
  }
}
