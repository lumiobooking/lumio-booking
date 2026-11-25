import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
  constructor(private readonly prisma: PrismaService, @Optional() private readonly audit?: AuditService) {}

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

  /**
   * rt234: taken back to the till (recalled) or thrown away. Throwing a held
   * bill away is written to the audit log (who, how much, when), so a bill
   * shown to a customer and then dropped can be found later.
   */
  async remove(user: AuthenticatedUser, id: string, opts: { recalled?: boolean } = {}) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.heldBill.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Held bill not found');
    await this.prisma.heldBill.deleteMany({ where: { id, tenantId } });
    if (!opts.recalled) {
      await this.audit?.log({
        tenantId, userId: user.userId, action: 'pos.held_discarded', resourceType: 'held_bill', resourceId: id,
        metadata: { label: existing.label, amountCents: existing.totalCents, heldBy: existing.createdByUserId, heldAt: existing.createdAt },
      });
    }
    return { ok: true };
  }
}
