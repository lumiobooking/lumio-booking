import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, UserRole, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../auth/password.util';
import { PosService } from '../pos/pos.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateStaffDto, WorkingHourDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { CreateStaffLoginDto } from './dto/create-staff-login.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';

const STAFF_INCLUDE = {
  staffServices: { select: { serviceId: true } },
  workingHours: {
    select: { id: true, dayOfWeek: true, startTime: true, endTime: true, isActive: true },
  },
  user: { select: { id: true, email: true } },
};

/**
 * Staff members belong to one tenant. Skills (staffServices) and working hours
 * are managed here too. Every query is scoped to the caller's tenantId, and any
 * referenced serviceId is validated to belong to the same tenant before linking
 * (so a salon can't attach another salon's service).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pos: PosService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) {
      throw new NotFoundException('No tenant context');
    }
    return id;
  }

  /** Ensure every serviceId belongs to this tenant; throws otherwise. */
  private async assertServicesBelongToTenant(tenantId: string, serviceIds: string[]) {
    if (serviceIds.length === 0) return;
    const count = await this.prisma.service.count({
      where: { tenantId, id: { in: serviceIds } },
    });
    if (count !== new Set(serviceIds).size) {
      throw new BadRequestException('One or more serviceIds are invalid for this tenant');
    }
  }

  /**
   * Per-technician performance for the salon owner: what each tech did in a date
   * range — completed visits, service revenue (list price of completed
   * appointments), money actually collected & tips through POS, star rating,
   * loyalty points, their #1 service, and their most recent customers with names
   * and dates. Everything is scoped to the caller's tenant.
   */
  async performance(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toStr ? new Date(toStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [staff, appts, feedback] = await Promise.all([
      this.prisma.staffMember.findMany({
        where: { tenantId },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, isActive: true, rewardPoints: true, commissionPercent: true },
        orderBy: { firstName: 'asc' },
      }),
      // Completed visits in range, by the tech who actually did them.
      this.prisma.appointment.findMany({
        where: { tenantId, status: 'COMPLETED', assignedStaffId: { not: null }, startTime: { gte: from, lte: to } },
        select: {
          assignedStaffId: true, priceCents: true, startTime: true,
          service: { select: { name: true } },
          customer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startTime: 'desc' },
      }),
      this.prisma.feedback.groupBy({
        by: ['staffId'],
        where: { tenantId, staffId: { not: null }, createdAt: { gte: from, lte: to } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    // POS money (collected revenue + tips) per tech in the same range.
    let posByStaff = new Map<string, { revenueCents: number; tipsCents: number }>();
    try {
      const rep = await this.pos.report(user, from.toISOString(), to.toISOString());
      posByStaff = new Map(
        (rep.staff ?? []).map((r: { staffId: string; serviceRevenueCents: number; productRevenueCents: number; tipsCents: number }) =>
          [r.staffId, { revenueCents: r.serviceRevenueCents + r.productRevenueCents, tipsCents: r.tipsCents }]),
      );
    } catch { /* POS optional */ }

    const fb = new Map(feedback.map((f) => [f.staffId as string, { avg: f._avg.rating ?? 0, count: f._count._all }]));

    type Acc = {
      completed: number; serviceRevenueCents: number;
      services: Map<string, number>;
      recent: { name: string; date: string; service: string }[];
    };
    const acc = new Map<string, Acc>();
    const blank = (): Acc => ({ completed: 0, serviceRevenueCents: 0, services: new Map(), recent: [] });
    for (const a of appts) {
      const id = a.assignedStaffId as string;
      const x = acc.get(id) ?? blank();
      x.completed += 1;
      x.serviceRevenueCents += a.priceCents ?? 0;
      const svc = a.service?.name ?? '—';
      x.services.set(svc, (x.services.get(svc) ?? 0) + 1);
      if (x.recent.length < 12) {
        x.recent.push({
          name: `${a.customer?.firstName ?? ''} ${a.customer?.lastName ?? ''}`.trim() || 'Guest',
          date: a.startTime.toISOString(),
          service: svc,
        });
      }
      acc.set(id, x);
    }

    const rows = staff.map((s) => {
      const x = acc.get(s.id) ?? blank();
      const pos = posByStaff.get(s.id) ?? { revenueCents: 0, tipsCents: 0 };
      const rev = fb.get(s.id) ?? { avg: 0, count: 0 };
      let topService: { name: string; count: number } | null = null;
      for (const [name, count] of x.services) if (!topService || count > topService.count) topService = { name, count };
      return {
        staffId: s.id,
        name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
        avatarUrl: s.avatarUrl,
        isActive: s.isActive,
        completed: x.completed,
        serviceRevenueCents: x.serviceRevenueCents,   // list price of completed visits
        collectedCents: pos.revenueCents,              // money actually taken via POS
        tipsCents: pos.tipsCents,
        rating: Math.round((rev.avg || 0) * 10) / 10,
        reviewCount: rev.count,
        points: s.rewardPoints ?? 0,
        topService,
        recent: x.recent,
      };
    });
    // Best earners first; unused techs sink to the bottom.
    rows.sort((a, b) => (b.collectedCents + b.serviceRevenueCents) - (a.collectedCents + a.serviceRevenueCents) || b.completed - a.completed);

    const totals = rows.reduce((t, r) => ({
      completed: t.completed + r.completed,
      serviceRevenueCents: t.serviceRevenueCents + r.serviceRevenueCents,
      collectedCents: t.collectedCents + r.collectedCents,
      tipsCents: t.tipsCents + r.tipsCents,
      reviewCount: t.reviewCount + r.reviewCount,
    }), { completed: 0, serviceRevenueCents: 0, collectedCents: 0, tipsCents: 0, reviewCount: 0 });

    return { range: { from: from.toISOString(), to: to.toISOString() }, rows, totals };
  }

  list(user: AuthenticatedUser) {
    return this.prisma.staffMember.findMany({
      where: { tenantId: this.tenantId(user) },
      include: STAFF_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The signed-in staff user's OWN profile (linked via userId). */
  private async myStaffRecord(user: AuthenticatedUser) {
    const staff = await this.prisma.staffMember.findFirst({
      where: { tenantId: this.tenantId(user), userId: user.userId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, tipQrUrl: true, tipHandle: true },
    });
    if (!staff) throw new NotFoundException('No staff profile is linked to your account');
    return staff;
  }

  getMyProfile(user: AuthenticatedUser) {
    return this.myStaffRecord(user);
  }

  /** A staff member updates their own name/phone/photo (nothing else). */
  async updateMyProfile(user: AuthenticatedUser, dto: UpdateMyProfileDto) {
    const me = await this.myStaffRecord(user);
    const updated = await this.prisma.staffMember.update({
      where: { id: me.id },
      data: {
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        phone: dto.phone ?? undefined,
        avatarUrl: dto.avatarUrl === undefined ? undefined : (dto.avatarUrl || null),
        tipQrUrl: dto.tipQrUrl === undefined ? undefined : (dto.tipQrUrl || null),
        tipHandle: dto.tipHandle === undefined ? undefined : (dto.tipHandle?.trim() || null),
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true, tipQrUrl: true, tipHandle: true },
    });
    await this.audit.log({ tenantId: this.tenantId(user), userId: user.userId, action: 'staff.self_profile_updated', resourceType: 'staff', resourceId: me.id });
    return updated;
  }

  async getById(user: AuthenticatedUser, id: string) {
    const staff = await this.prisma.staffMember.findFirst({
      where: { id, tenantId: this.tenantId(user) },
      include: STAFF_INCLUDE,
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  async create(user: AuthenticatedUser, dto: CreateStaffDto) {
    const tenantId = this.tenantId(user);
    const serviceIds = dto.serviceIds ?? [];
    await this.assertServicesBelongToTenant(tenantId, serviceIds);

    // Role drives RBAC; bookable visibility defaults from role but can be set
    // explicitly (e.g. an owner/manager who also takes appointments).
    const role = dto.staffRole ?? StaffRole.TECHNICIAN;
    const takesAppointments = dto.takesAppointments ?? role === StaffRole.TECHNICIAN;

    // Optional inline login. Validate intent + uniqueness before the txn, and
    // hash outside it so the transaction stays short.
    const wantsLogin = !!(dto.loginEmail || dto.loginPassword);
    let loginEmail: string | null = null;
    let passwordHash: string | null = null;
    if (wantsLogin) {
      if (!dto.loginEmail || !dto.loginPassword) {
        throw new BadRequestException('Provide both a login email and password, or leave both blank.');
      }
      loginEmail = dto.loginEmail.toLowerCase();
      const existing = await this.prisma.user.findUnique({ where: { email: loginEmail } });
      if (existing) {
        throw new ConflictException('A user with this login email already exists');
      }
      passwordHash = await hashSecret(dto.loginPassword);
    }

    const staff = await this.prisma.$transaction(async (tx) => {
      const created = await tx.staffMember.create({
        data: {
          tenantId,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          avatarUrl: dto.avatarUrl ?? null,
          tipQrUrl: dto.tipQrUrl ?? null,
          tipHandle: dto.tipHandle?.trim() || null,
          isActive: dto.isActive ?? true,
          staffRole: role,
          takesAppointments,
        },
      });

      if (serviceIds.length > 0) {
        await tx.staffService.createMany({
          data: serviceIds.map((serviceId) => ({ tenantId, staffMemberId: created.id, serviceId })),
        });
      }

      await this.createWorkingHours(tx, tenantId, created.id, dto.workingHours ?? []);

      // Link a new STAFF login if requested. Caps for this user are later
      // derived from staffRole, so a receptionist gets cashier-only access.
      if (loginEmail && passwordHash) {
        const newUser = await tx.user.create({
          data: {
            tenantId,
            role: UserRole.STAFF,
            email: loginEmail,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName ?? null,
          },
        });
        await tx.staffMember.update({ where: { id: created.id }, data: { userId: newUser.id } });
      }

      return created;
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'staff.created',
      resourceType: 'staff_member',
      resourceId: staff.id,
      metadata: { name: `${dto.firstName} ${dto.lastName ?? ''}`.trim(), staffRole: role, loginCreated: !!loginEmail },
    });

    return this.getById(user, staff.id);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateStaffDto) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // tenant ownership / 404

    if (dto.serviceIds) {
      await this.assertServicesBelongToTenant(tenantId, dto.serviceIds);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.staffMember.updateMany({
        where: { id, tenantId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          avatarUrl: dto.avatarUrl,
          tipQrUrl: dto.tipQrUrl === undefined ? undefined : (dto.tipQrUrl || null),
          tipHandle: dto.tipHandle === undefined ? undefined : (dto.tipHandle?.trim() || null),
          isActive: dto.isActive,
          performanceScore: dto.performanceScore,
          commissionPercent: dto.commissionPercent,
          baseCents: dto.baseCents,
          staffRole: dto.staffRole,
          takesAppointments: dto.takesAppointments,
          bookingPriority: dto.bookingPriority,
        },
      });

      // Replace skills when provided.
      if (dto.serviceIds) {
        await tx.staffService.deleteMany({ where: { tenantId, staffMemberId: id } });
        if (dto.serviceIds.length > 0) {
          await tx.staffService.createMany({
            data: dto.serviceIds.map((serviceId) => ({ tenantId, staffMemberId: id, serviceId })),
          });
        }
      }

      // Replace working hours when provided.
      if (dto.workingHours) {
        await tx.staffWorkingHour.deleteMany({ where: { tenantId, staffMemberId: id } });
        await this.createWorkingHours(tx, tenantId, id, dto.workingHours);
      }
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'staff.updated',
      resourceType: 'staff_member',
      resourceId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return this.getById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id);
    // Cascades remove staffServices / workingHours via the schema relations.
    await this.prisma.staffMember.deleteMany({ where: { id, tenantId } });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'staff.deleted',
      resourceType: 'staff_member',
      resourceId: id,
    });
    return { id, deleted: true };
  }

  /**
   * Creates a STAFF login account for a staff member so they can sign in and see
   * their assigned bookings. The new user is scoped to this tenant and linked
   * via StaffMember.userId.
   */
  async createLogin(user: AuthenticatedUser, staffId: string, dto: CreateStaffLoginDto) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, tenantId },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (staff.userId) {
      throw new ConflictException('This staff member already has a login');
    }

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await hashSecret(dto.password);
    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          tenantId,
          role: UserRole.STAFF,
          email,
          passwordHash,
          firstName: staff.firstName,
          lastName: staff.lastName,
        },
      });
      await tx.staffMember.update({ where: { id: staffId }, data: { userId: newUser.id } });
      return newUser;
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'staff.login_created',
      resourceType: 'staff_member',
      resourceId: staffId,
      metadata: { email },
    });

    return { staffMemberId: staffId, email: created.email };
  }

  /**
   * Resets the password on a staff member's EXISTING login. Admin-initiated — the
   * salon owner can hand a tech a new password without involving support. Scoped to
   * this tenant: only this salon's staff, and only their linked user, can be changed.
   */
  async resetLogin(user: AuthenticatedUser, staffId: string, dto: ResetStaffPasswordDto) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, tenantId },
      select: { id: true, userId: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    if (!staff.userId) {
      throw new BadRequestException('This staff member has no login yet — create one first.');
    }
    // Defence in depth: confirm the linked user belongs to THIS tenant before touching it.
    const account = await this.prisma.user.findFirst({
      where: { id: staff.userId, tenantId },
      select: { id: true, email: true },
    });
    if (!account) {
      throw new NotFoundException('Login account not found');
    }

    const passwordHash = await hashSecret(dto.password);
    // passwordChangedAt forces the staff member to sign in again (old tokens die).
    await this.prisma.user.update({ where: { id: account.id }, data: { passwordHash, passwordChangedAt: new Date() } });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'staff.password_reset',
      resourceType: 'staff_member',
      resourceId: staffId,
      metadata: { email: account.email },
    });

    return { staffMemberId: staffId, email: account.email, reset: true };
  }

  private async createWorkingHours(
    tx: Prisma.TransactionClient,
    tenantId: string,
    staffMemberId: string,
    hours: WorkingHourDto[],
  ): Promise<void> {
    if (hours.length === 0) {
      return;
    }
    await tx.staffWorkingHour.createMany({
      data: hours.map((h) => ({
        tenantId,
        staffMemberId,
        dayOfWeek: h.dayOfWeek,
        startTime: h.startTime,
        endTime: h.endTime,
      })),
    });
  }
}
