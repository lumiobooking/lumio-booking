import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

/**
 * Recycle bin.
 *
 * Deleting used to be final: one wrong click and a booking, its payments and
 * the customer's history were gone with no way back. Now every delete takes a
 * snapshot first, keeps it for a grace period, and only then lets it go.
 *
 * Deliberately generic — it stores rows as JSON rather than knowing about each
 * table — so any delete path can be routed through it without new plumbing.
 */
@Injectable()
export class TrashService {
  private readonly logger = new Logger('Trash');

  /** How long a deleted item can be put back. */
  static readonly GRACE_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /**
   * Record a deletion. Call this INSIDE the same transaction that removes the
   * rows, so the bin and the delete either both happen or neither does.
   *
   * `snapshot` should carry everything needed to rebuild the item, including
   * child rows: { appointment: {...}, payments: [...] }.
   */
  async capture(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      entity: string;
      entityId: string;
      label: string;
      snapshot: unknown;
      deletedByUserId?: string | null;
    },
  ) {
    const expiresAt = new Date(Date.now() + TrashService.GRACE_DAYS * 24 * 60 * 60 * 1000);
    return tx.trashItem.create({
      data: {
        tenantId: input.tenantId,
        entity: input.entity,
        entityId: input.entityId,
        label: input.label.slice(0, 200),
        snapshot: input.snapshot as Prisma.InputJsonValue,
        deletedByUserId: input.deletedByUserId ?? null,
        expiresAt,
      },
      select: { id: true },
    });
  }

  /** What is still recoverable, newest first. Scoped to the caller's salon. */
  async list(user: AuthenticatedUser, entity?: string) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.trashItem.findMany({
      where: {
        tenantId,
        restoredAt: null,
        expiresAt: { gt: new Date() },
        ...(entity ? { entity } : {}),
      },
      select: { id: true, entity: true, entityId: true, label: true, deletedAt: true, expiresAt: true },
      orderBy: { deletedAt: 'desc' },
      take: 200,
    });
    // Days left is what staff actually care about, so compute it here rather
    // than making every client do the date maths.
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      daysLeft: Math.max(0, Math.ceil((r.expiresAt.getTime() - now) / 86400000)),
    }));
  }

  /** One item with its full snapshot (used by the restore screen). */
  async get(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const item = await this.prisma.trashItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('This item is no longer in the bin.');
    return item;
  }

  /**
   * Mark an item restored. The caller re-inserts the rows from the snapshot in
   * its own transaction and then calls this, so the bin never has to know how
   * any particular table is put back together.
   */
  async markRestored(tx: Prisma.TransactionClient, id: string, tenantId: string) {
    await tx.trashItem.updateMany({ where: { id, tenantId }, data: { restoredAt: new Date() } });
  }

  /**
   * Drop expired snapshots. Called by the daily sweep — this is the ONLY place
   * data actually leaves the database, and only after the grace period.
   */
  async purgeExpired(): Promise<number> {
    const r = await this.prisma.trashItem.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (r.count > 0) this.logger.log(`Purged ${r.count} expired bin item(s).`);
    return r.count;
  }
}
