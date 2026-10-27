import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { concatMap, from, Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { contactModeOf, isTechViewer, redactContacts, STAFF_PRIVACY_KEY } from './contact-privacy';

/**
 * On a route the technician app reads, a technician's response leaves the
 * server with client phones and emails masked as the salon chose
 * (contact-privacy.ts). Everyone else's response is untouched. The salon is
 * the signed-in user's own (its setting row is read under that tenant only).
 */
@Injectable()
export class ContactPrivacyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest()?.user as { role?: string; staffRole?: string | null; tenantId?: string | null } | undefined;
    if (!isTechViewer(user) || !user?.tenantId) return next.handle();
    const tenantId = user.tenantId;
    return next.handle().pipe(concatMap((body) => from((async () => {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: STAFF_PRIVACY_KEY } } }).catch(() => null);
      return redactContacts(body, contactModeOf(row?.value ?? null));
    })())));
  }
}
