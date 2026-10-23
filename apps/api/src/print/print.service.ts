import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrintJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { PrintDevicesService } from './print-devices.service';

@Injectable()
export class PrintService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly devices?: PrintDevicesService) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Phone enqueues a pre-rendered text receipt for the reception printer. */
  async enqueue(user: AuthenticatedUser, dto: { title?: string; text: string; copies?: number; drawer?: boolean }) {
    const tenantId = this.tid(user);
    const text = (dto.text ?? '').slice(0, 20000);
    if (!text.trim()) throw new BadRequestException('Receipt text is empty');
    return this.prisma.printJob.create({
      data: {
        tenantId,
        title: dto.title?.slice(0, 120) || null,
        text,
        copies: Math.max(1, Math.min(5, Math.round(dto.copies ?? 1))),
        // A cash sale's receipt opens the drawer plugged into the counter printer.
        drawer: dto.drawer === true,
        createdById: user.userId,
      },
      select: { id: true, status: true, createdAt: true },
    });
  }

  /** Recent jobs for the salon's status view. */
  async recent(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    return this.prisma.printJob.findMany({
      where: { tenantId },
      select: { id: true, status: true, title: true, createdAt: true, printedAt: true, error: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  // ---- Reception agent (tenantId resolved from the API key, not a JWT) ----

  /**
   * The reception agent polls for receipts to print. A restaurant's agent may
   * name the stations it serves (`COUNTER` = jobs with no station): an agent
   * that names none takes every job, so a one-printer shop still gets its
   * kitchen tickets.
   */
  async pending(tenantId: string, stations?: string) {
    // A one-touch computer is online: it takes the tickets, the old agent stands down (no double printing).
    if (this.devices && await this.devices.liveDeviceFor(tenantId)) return [];
    const wanted = String(stations ?? '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9_]{2,20}$/.test(x));
    // Drawer-only jobs (no text) are for the one-touch computer; the old agent would print a blank page.
    const where: Record<string, unknown> = { tenantId, status: PrintJobStatus.PENDING, claimedAt: null, text: { not: '' } };
    if (wanted.length) {
      const named = wanted.filter((x) => x !== 'COUNTER');
      where.OR = [
        ...(named.length ? [{ station: { in: named } }] : []),
        ...(wanted.includes('COUNTER') ? [{ station: null }] : []),
      ];
    }
    return this.prisma.printJob.findMany({
      where: where as never,
      select: { id: true, title: true, text: true, copies: true, station: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
  }

  /** The agent reports a job's outcome (tenant-scoped by the API key). */
  async result(tenantId: string, jobId: string, ok: boolean, error?: string) {
    const job = await this.prisma.printJob.findFirst({ where: { id: jobId, tenantId }, select: { id: true } });
    if (!job) throw new NotFoundException('Print job not found');
    await this.prisma.printJob.updateMany({
      where: { id: jobId, tenantId },
      data: ok
        ? { status: PrintJobStatus.PRINTED, printedAt: new Date(), error: null }
        : { status: PrintJobStatus.FAILED, error: (error ?? 'print failed').slice(0, 500) },
    });
    return { id: jobId, ok };
  }
}
