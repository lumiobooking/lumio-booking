import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** List the salon's customers, newest first, with booking + no-show counts. */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        loyaltyPoints: true,
        _count: { select: { appointments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // No-show count per customer (drives the "repeat no-show" risk flag).
    const grouped = await this.prisma.appointment.groupBy({
      by: ['customerId'],
      where: { tenantId, status: 'NO_SHOW' },
      _count: { _all: true },
    });
    const noShowById = new Map(grouped.map((g) => [g.customerId, g._count._all]));
    return customers.map((c) => ({ ...c, noShowCount: noShowById.get(c.id) ?? 0 }));
  }

  /** Typeahead for the POS/front desk: match by name or phone. Tenant-scoped. */
  async search(user: AuthenticatedUser, q: string) {
    const tenantId = this.tenantId(user);
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const digits = term.replace(/[^\d]/g, '');
    const or: Prisma.CustomerWhereInput[] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
    ];
    if (digits.length >= 3) or.push({ phone: { contains: digits } });
    return this.prisma.customer.findMany({
      where: { tenantId, OR: or },
      select: { id: true, firstName: true, lastName: true, phone: true, loyaltyPoints: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
  }

  /** Front-desk quick-add (POS): find-or-create by phone/email, return a brief. */
  async quickCreate(
    user: AuthenticatedUser,
    dto: { firstName?: string; lastName?: string; phone?: string; email?: string },
  ) {
    const tenantId = this.tenantId(user);
    const c = await this.findOrCreateByContact(tenantId, dto);
    if (!c) throw new BadRequestException('A phone number or email is required to add a customer.');
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.created', resourceType: 'customer', resourceId: c.id });
    return c;
  }

  private normPhone(p?: string | null): string | null {
    const v = (p ?? '').replace(/[^\d+]/g, '');
    return v.replace(/\D/g, '').length >= 7 ? v : null;
  }

  /**
   * Find an existing customer by phone (the salon's natural key), else by email,
   * else create one. Returns a brief, or null when there's nothing to key on
   * (no phone and no email — we don't create anonymous duplicates). Backfills
   * missing name/phone/email on an existing row without overwriting good data.
   */
  async findOrCreateByContact(
    tenantId: string,
    input: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null },
  ) {
    const phone = this.normPhone(input.phone);
    const email = (input.email ?? '').trim().toLowerCase() || null;
    const firstName = (input.firstName ?? '').trim().slice(0, 80) || 'Walk-in';
    const lastName = (input.lastName ?? '').trim().slice(0, 80) || null;

    let existing = phone
      ? await this.prisma.customer.findFirst({ where: { tenantId, phone }, select: { id: true, firstName: true, email: true, phone: true } })
      : null;
    if (!existing && email) {
      existing = await this.prisma.customer.findFirst({ where: { tenantId, email }, select: { id: true, firstName: true, email: true, phone: true } });
    }
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (phone && !existing.phone) patch.phone = phone;
      if (email && !existing.email) patch.email = email;
      if ((!existing.firstName || existing.firstName === 'Walk-in') && firstName !== 'Walk-in') patch.firstName = firstName;
      if (Object.keys(patch).length) await this.prisma.customer.updateMany({ where: { id: existing.id, tenantId }, data: patch });
      return this.brief(tenantId, existing.id);
    }
    if (!phone && !email) return null; // nothing to dedupe on → skip
    const created = await this.prisma.customer.create({ data: { tenantId, firstName, lastName, phone, email }, select: { id: true } });
    return this.brief(tenantId, created.id);
  }

  private brief(tenantId: string, id: string) {
    return this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, loyaltyPoints: true },
    });
  }

  /** A single customer with their full history: bookings + payments + totals. */
  async getById(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        notes: true,
        birthDate: true,
        createdAt: true,
        loyaltyPoints: true,
        loyaltyTransactions: {
          select: { id: true, points: true, balanceAfter: true, reason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
        appointments: {
          select: {
            id: true,
            status: true,
            startTime: true,
            service: { select: { name: true } },
            assignedStaff: { select: { firstName: true, lastName: true } },
            payments: { select: { id: true, amountCents: true, currency: true, status: true, type: true, createdAt: true } },
          },
          orderBy: { startTime: 'desc' },
          take: 100,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    // Flatten payments + compute lifetime totals (PAID only = real collected).
    const payments = customer.appointments.flatMap((a) => a.payments);
    const totalSpentCents = payments
      .filter((p) => p.status === 'PAID')
      .reduce((s, p) => s + p.amountCents, 0);
    const completed = customer.appointments.filter((a) => a.status === 'COMPLETED').length;
    const noShows = customer.appointments.filter((a) => a.status === 'NO_SHOW').length;
    return {
      ...customer,
      stats: {
        bookings: customer.appointments.length,
        completed,
        noShows,
        totalSpentCents,
        lastVisit: customer.appointments[0]?.startTime ?? null,
      },
    };
  }

  /** Edit a customer's profile (birthday + basic contact fields). Tenant-scoped. */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: { birthDate?: string | null; firstName?: string; lastName?: string | null; email?: string | null; phone?: string | null; notes?: string | null },
  ) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.customer.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Customer not found');
    const data: Record<string, unknown> = {};
    if ('birthDate' in dto) {
      const v = dto.birthDate ? new Date(dto.birthDate) : null;
      data.birthDate = v && !isNaN(v.getTime()) ? v : null;
    }
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName || null;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    // Scope the write by tenantId too (a forged id can't touch another tenant).
    await this.prisma.customer.updateMany({ where: { id, tenantId }, data });
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.updated', resourceType: 'customer', resourceId: id });
    return this.getById(user, id);
  }

  /** Delete a customer (and, by cascade, their appointments). Admin only. */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.customer.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Customer not found');
    // deleteMany with tenantId is a safety net so a forged id can't touch another tenant.
    await this.prisma.customer.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'customer.deleted', resourceType: 'customer', resourceId: id });
    return { id, deleted: true };
  }
}
