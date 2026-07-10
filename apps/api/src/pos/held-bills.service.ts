import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

export interface CreateHeldBill {
  label?: string;
  customerId?: string;
  totalCents?: number;
  payload?: Record<string, unknown>;
}

/** Parked POS carts ("bill chờ"). Tenant-scoped so any register can recall them. */
@Injectable()
export class HeldBillsService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  list(user: AuthenticatedUser) {
    return this.prisma.heldBill.findMany({ where: { tenantId: this.tenantId(user) }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  create(user: AuthenticatedUser, dto: CreateHeldBill) {
    const tenantId = this.tenantId(user);
    return this.prisma.heldBill.create({
      data: {
        tenantId,
        label: dto.label?.toString().trim().slice(0, 80) || null,
        customerId: dto.customerId || null,
        totalCents: Math.max(0, Math.round(dto.totalCents || 0)),
        payload: (dto.payload ?? {}) as unknown as Prisma.InputJsonValue,
        createdByUserId: user.userId,
      },
    });
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.heldBill.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Held bill not found');
    await this.prisma.heldBill.delete({ where: { id } });
    return { ok: true };
  }
}
