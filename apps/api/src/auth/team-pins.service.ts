import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { cleanStaffCaps, hasCapability } from './capabilities';
import { hashSecret, verifySecret } from './password.util';

/**
 * Approval PINs of a salon's approvers, set by someone else (19/11/2026).
 *
 * The owner's request: "support@lumiobooking.com cũng sẽ có quyền setup cái
 * này cho khách" — Lumio Support, working inside one salon, and that salon's
 * owner may set the till PIN of the salon's owners and managers, so a new
 * restaurant leaves setup with real PINs instead of the default 0000.
 *
 * Rules:
 *  - Only a support session (not the 'content' level) or the salon's own
 *    owner (SALON_ADMIN, not a support session) may do it.
 *  - The person must belong to THIS salon (tenantId from the token, never
 *    from the request), be active, and be allowed to refund & void.
 *  - Two approvers of one salon never share a PIN.
 *  - Every set / clear writes audit_logs with who did it and for whom; the
 *    PIN itself is never logged or returned.
 */
export interface TeamPinRow { id: string; name: string; email: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; set: boolean }

type Approver = { id: string; email: string; firstName: string | null; lastName: string | null; role: UserRole; approvalPinHash: string | null; label: TeamPinRow['role'] };

export function maySetTeamPins(user: Pick<AuthenticatedUser, 'role' | 'tenantId' | 'supportSession' | 'supportLevel'>): boolean {
  if (!user.tenantId) return false;
  if (user.supportSession) return user.supportLevel !== 'content';
  return user.role === UserRole.SALON_ADMIN;
}

@Injectable()
export class TeamPinsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private guard(user: AuthenticatedUser): string {
    if (!maySetTeamPins(user)) throw new ForbiddenException('Only the salon owner or Lumio Support can set PINs for others.');
    return user.tenantId as string;
  }

  /** The salon's active people who may approve refunds and voids. */
  private async approvers(tenantId: string): Promise<Approver[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: [UserRole.SALON_ADMIN, UserRole.STAFF] } },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, approvalPinHash: true } as never,
      orderBy: { createdAt: 'asc' },
      take: 500,
    }) as unknown as { id: string; email: string; firstName: string | null; lastName: string | null; role: UserRole; approvalPinHash: string | null }[];
    const staff = users.filter((u) => u.role === UserRole.STAFF);
    const cards = staff.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, userId: { in: staff.map((u) => u.id) } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as { userId: string; staffRole: StaffRole | null; permissions: unknown }[]
      : [];
    return users.flatMap((u): Approver[] => {
      if (u.role === UserRole.SALON_ADMIN) return [{ ...u, label: 'OWNER' }];
      const sm = cards.find((c) => c.userId === u.id);
      if (!hasCapability(UserRole.STAFF, sm?.staffRole ?? null, 'pos.void', cleanStaffCaps(sm?.permissions) ?? undefined)) return [];
      return [{ ...u, label: sm?.staffRole === 'MANAGER' ? 'MANAGER' : 'STAFF' }];
    });
  }

  async list(user: AuthenticatedUser): Promise<{ people: TeamPinRow[] }> {
    const tenantId = this.guard(user);
    const people = await this.approvers(tenantId);
    return {
      people: people.map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email.split('@')[0],
        email: p.email,
        role: p.label,
        set: !!p.approvalPinHash,
      })),
    };
  }

  async set(user: AuthenticatedUser, targetId: string, pin: string): Promise<{ ok: true; set: boolean }> {
    const tenantId = this.guard(user);
    const people = await this.approvers(tenantId);
    const target = people.find((p) => p.id === String(targetId ?? ''));
    // Another salon's person, a removed one, or someone who may not approve:
    // all look the same from here.
    if (!target) throw new NotFoundException('That person is not an approver of this salon.');
    const clean = String(pin ?? '').trim();
    if (!clean) {
      await this.prisma.user.update({ where: { id: target.id }, data: { approvalPinHash: null } as never });
      await this.audit.log({ tenantId, userId: user.userId, action: 'approval_pin.cleared_for', resourceType: 'user', resourceId: target.id, metadata: { bySupport: !!user.supportSession } });
      return { ok: true, set: false };
    }
    if (!/^\d{4,6}$/.test(clean)) throw new BadRequestException('The PIN is 4 to 6 digits.');
    if (clean === '0000') throw new BadRequestException('Pick a PIN other than 0000 — that is the default everyone knows.');
    for (const o of people) {
      if (o.id !== target.id && o.approvalPinHash && await verifySecret(clean, o.approvalPinHash)) {
        throw new BadRequestException('Someone else in this salon uses that PIN — pick another.');
      }
    }
    await this.prisma.user.update({ where: { id: target.id }, data: { approvalPinHash: await hashSecret(clean) } as never });
    await this.audit.log({ tenantId, userId: user.userId, action: 'approval_pin.set_for', resourceType: 'user', resourceId: target.id, metadata: { bySupport: !!user.supportSession } });
    return { ok: true, set: true };
  }
}
