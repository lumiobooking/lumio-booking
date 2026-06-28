import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrintJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

@Injectable()
export class PrintService {
  constructor(private readonly prisma: PrismaService) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Phone enqueues a pre-rendered text receipt for the reception printer. */
  async enqueue(user: AuthenticatedUser, dto: { title?: string; text: string; copies?: number }) {
    const tenantId = this.tid(user);
    const text = (dto.text ?? '').slice(0, 20000);
    if (!text.trim()) throw new BadRequestException('Receipt text is empty');
    return this.prisma.printJob.create({
      data: {
        tenantId,
        title: dto.title?.slice(0, 120) || null,
        text,
        copies: Math.max(1, Math.min(5, Math.round(dto.copies ?? 1))),
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

  /** The reception agent polls for receipts to print. */
  async pending(tenantId: string) {
    return this.prisma.printJob.findMany({
      where: { tenantId, status: PrintJobStatus.PENDING },
      select: { id: true, title: true, text: true, copies: true, createdAt: true },
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
