import { Injectable, NotFoundException } from '@nestjs/common';
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

  /** List the salon's customers, newest first, with their booking counts. */
  list(user: AuthenticatedUser) {
    return this.prisma.customer.findMany({
      where: { tenantId: this.tenantId(user) },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        _count: { select: { appointments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** A single customer with their recent bookings. */
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
        createdAt: true,
        appointments: {
          select: {
            id: true,
            status: true,
            startTime: true,
            service: { select: { name: true } },
            assignedStaff: { select: { firstName: true, lastName: true } },
          },
          orderBy: { startTime: 'desc' },
          take: 20,
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
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
