import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { cleanLayout, EMPTY_LAYOUT, STAFF_LAYOUT_KEY, type StaffLayout } from './staff-layout';

/** The owner and managers change the line-up; everyone at the desk reads it. */
export function canArrange(user: AuthenticatedUser): boolean {
  if (user.role === UserRole.SALON_ADMIN || user.role === UserRole.SUPER_ADMIN) return true;
  return user.role === UserRole.STAFF && user.staffRole === StaffRole.MANAGER;
}

@Injectable()
export class CalendarLayoutService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  async get(user: AuthenticatedUser): Promise<StaffLayout & { canEdit: boolean }> {
    const tenantId = this.tenantId(user);
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: STAFF_LAYOUT_KEY } } }).catch(() => null);
    return { ...(row ? cleanLayout(row.value) : EMPTY_LAYOUT), canEdit: canArrange(user) };
  }

  async save(user: AuthenticatedUser, dto: unknown): Promise<StaffLayout & { canEdit: boolean }> {
    if (!canArrange(user)) throw new ForbiddenException('Only the owner or a manager can arrange the technicians');
    const tenantId = this.tenantId(user);
    // Only this salon's own people can be written into its line-up.
    const staff = await this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true } });
    const value = cleanLayout(dto, new Set(staff.map((s) => s.id)));
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: STAFF_LAYOUT_KEY } },
      update: { value: value as never },
      create: { tenantId, key: STAFF_LAYOUT_KEY, value: value as never },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'calendar.staff_layout_saved', resourceType: 'setting', resourceId: STAFF_LAYOUT_KEY, metadata: { count: value.order.length, hidden: value.hidden.length } });
    return { ...value, canEdit: true };
  }
}
