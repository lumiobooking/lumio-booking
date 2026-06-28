import { Injectable } from '@nestjs/common';
import { AppointmentStatus, PaymentStatus, StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const EXCLUDED = [AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every tenant id this user may operate as: their home salon, plus — for a chain
   * owner — all branches in their account group, plus any explicit manager
   * memberships. Returns [] for SUPER_ADMIN (not branch-scoped).
   */
  async allowedBranchIds(user: AuthenticatedUser): Promise<string[]> {
    if (user.role === UserRole.SUPER_ADMIN) return [];
    const ids = new Set<string>();
    if (user.tenantId) ids.add(user.tenantId);
    if (user.homeTenantId) ids.add(user.homeTenantId);

    const u = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { accountGroupId: true, branchMemberships: { select: { tenantId: true } } },
    });
    if (!u) return [...ids];

    // A chain owner OR a manager linked to the group → every branch in the group.
    // Cashiers/technicians never get group-wide access even if mis-linked.
    const ownerOrManager =
      user.role === UserRole.SALON_ADMIN ||
      (user.role === UserRole.STAFF && user.staffRole === StaffRole.MANAGER);
    if (u.accountGroupId && ownerOrManager) {
      const branches = await this.prisma.tenant.findMany({
        where: { accountGroupId: u.accountGroupId, deletedAt: null },
        select: { id: true },
      });
      for (const b of branches) ids.add(b.id);
    }
    // Explicit per-branch grants (future-proofing) → extra branches.
    for (const m of u.branchMemberships) ids.add(m.tenantId);
    return [...ids];
  }

  /** May this user act as the given branch? (home, group branch, or membership.) */
  async canAccess(user: AuthenticatedUser, tenantId: string): Promise<boolean> {
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (user.tenantId === tenantId || user.homeTenantId === tenantId) return true;
    return (await this.allowedBranchIds(user)).includes(tenantId);
  }

  /** Branch list for the switcher. `canSwitch` is false for single-salon users. */
  async listForUser(user: AuthenticatedUser) {
    const ids = await this.allowedBranchIds(user);
    const home = user.homeTenantId ?? user.tenantId;
    if (ids.length <= 1) {
      return { canSwitch: false, homeTenantId: home, branches: [] as { id: string; name: string; slug: string }[] };
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    return { canSwitch: true, homeTenantId: home, branches: tenants };
  }

  /**
   * Consolidated revenue across all of the user's branches for a date range.
   * Revenue = PAID payments (POS + bookings both flow through Payment), excluding
   * payments tied to a cancelled/rejected booking — matching the dashboard.
   */
  async chainReport(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const ids = await this.allowedBranchIds(user);
    const now = new Date();
    const endBase = toStr ? new Date(`${toStr}T00:00:00`) : now;
    const to = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), 23, 59, 59, 999);
    let from: Date;
    if (fromStr) {
      const f = new Date(`${fromStr}T00:00:00`);
      from = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    } else {
      from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
    }
    const range = { from: dayKey(from), to: dayKey(to) };
    if (ids.length === 0) return { range, totalCents: 0, branches: [] };

    const [revRows, apptRows, custRows, tenants] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { in: ids },
          status: PaymentStatus.PAID,
          paidAt: { gte: from, lte: to },
          OR: [{ appointmentId: null }, { appointment: { status: { notIn: EXCLUDED } } }],
        },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, startTime: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.customer.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: ids }, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);

    const revBy = new Map(revRows.map((r) => [r.tenantId, { rev: r._sum.amountCents ?? 0, pays: r._count._all }]));
    const bkBy = new Map(apptRows.map((r) => [r.tenantId, r._count._all]));
    const custBy = new Map(custRows.map((r) => [r.tenantId, r._count._all]));

    const branches = tenants
      .map((t) => ({
        tenantId: t.id,
        name: t.name,
        revenueCents: revBy.get(t.id)?.rev ?? 0,
        payments: revBy.get(t.id)?.pays ?? 0,
        bookings: bkBy.get(t.id) ?? 0,
        newCustomers: custBy.get(t.id) ?? 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    const totalCents = branches.reduce((s, b) => s + b.revenueCents, 0);
    const totalBookings = branches.reduce((s, b) => s + b.bookings, 0);
    return { range, totalCents, totalBookings, branches };
  }
}
