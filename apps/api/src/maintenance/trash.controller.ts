import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TrashService } from './trash.service';

class ListTrashDto {
  @IsOptional() @IsString() entity?: string;
}

/**
 * The salon's recycle bin. Anything deleted lands here for a grace period and
 * can be put back; after that the daily sweep removes it for good.
 */
@Roles(UserRole.SALON_ADMIN)
@Controller('trash')
export class TrashController {
  constructor(
    private readonly trash: TrashService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: ListTrashDto) {
    return this.trash.list(user, q.entity);
  }

  /**
   * Put an item back. Each entity is rebuilt from its own snapshot shape, so a
   * restore returns the row AND its children (a booking brings its payments).
   */
  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() _body: unknown) {
    const item = await this.trash.get(user, id);
    const tenantId = item.tenantId;
    const snap = item.snapshot as Record<string, unknown>;

    await this.prisma.$transaction(async (tx) => {
      if (item.entity === 'appointment') {
        const appt = snap.appointment as Prisma.AppointmentUncheckedCreateInput | null;
        if (appt) {
          // createMany + skipDuplicates: restoring twice is a no-op instead of
          // a crash, which matters when two staff tap Restore at once.
          await tx.appointment.createMany({ data: [appt], skipDuplicates: true });
        }
        const pays = (snap.payments ?? []) as Prisma.PaymentUncheckedCreateInput[];
        if (pays.length) await tx.payment.createMany({ data: pays, skipDuplicates: true });
      }
      if (item.entity === 'customer') {
        const cust = snap.customer as Prisma.CustomerUncheckedCreateInput | null;
        if (cust) await tx.customer.createMany({ data: [cust], skipDuplicates: true });
        const appts = (snap.appointments ?? []) as Prisma.AppointmentUncheckedCreateInput[];
        if (appts.length) await tx.appointment.createMany({ data: appts, skipDuplicates: true });
        const loyalty = (snap.loyalty ?? []) as Prisma.LoyaltyTransactionUncheckedCreateInput[];
        if (loyalty.length) await tx.loyaltyTransaction.createMany({ data: loyalty, skipDuplicates: true });
      }

      if (item.entity === 'order') {
        // The receipt was stored with its lines nested; split them back out.
        const raw = snap.order as (Prisma.OrderUncheckedCreateInput & { items?: unknown[]; payments?: unknown[] }) | null;
        if (raw) {
          const { items, payments, ...header } = raw as Record<string, unknown>;
          await tx.order.createMany({ data: [header as Prisma.OrderUncheckedCreateInput], skipDuplicates: true });
          const lines = (items ?? []) as Prisma.OrderItemUncheckedCreateInput[];
          if (lines.length) await tx.orderItem.createMany({ data: lines, skipDuplicates: true });
          void payments;
        }
        const mirrored = (snap.payments ?? []) as Prisma.PaymentUncheckedCreateInput[];
        if (mirrored.length) await tx.payment.createMany({ data: mirrored, skipDuplicates: true });
      }

      await this.trash.markRestored(tx, item.id, tenantId);
    });

    await this.audit.log({
      tenantId, userId: user.userId, action: 'trash.restored',
      resourceType: item.entity, resourceId: item.entityId, metadata: { trashId: item.id },
    });
    return { ok: true, entity: item.entity, entityId: item.entityId };
  }
}
