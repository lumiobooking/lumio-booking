import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import {
  DRIVEN_BRANDS, TERMINAL_REQUESTS_KEY, TERMINAL_REQUESTS_MAX, cleanRequest, readRequests,
  type RequestStatus, type TerminalRequest,
} from './terminal-requests';

/**
 * The salon's "connect my card machine" requests (terminal-requests.ts).
 * TENANT ISOLATION: the salon side reads and writes only the caller's own
 * setting row (tenant from the JWT); the platform side is SUPER_ADMIN only.
 */
@Injectable()
export class TerminalRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new BadRequestException('No salon in scope');
    return id;
  }

  private async read(tenantId: string): Promise<TerminalRequest[]> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: TERMINAL_REQUESTS_KEY } } }).catch(() => null);
    return readRequests(row?.value ?? null);
  }

  private async write(tenantId: string, list: TerminalRequest[]) {
    const value = list.slice(0, TERMINAL_REQUESTS_MAX) as never;
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: TERMINAL_REQUESTS_KEY } },
      create: { tenantId, key: TERMINAL_REQUESTS_KEY, value },
      update: { value },
    });
  }

  async list(user: AuthenticatedUser) {
    return this.read(this.tenantOf(user));
  }

  async create(user: AuthenticatedUser, dto: { brand?: string; model?: string; serial?: string; note?: string; phone?: string }) {
    const tenantId = this.tenantOf(user);
    const clean = cleanRequest(dto);
    if (!clean) throw new BadRequestException('Tell us the brand or the model of the machine');
    const u = user.userId ? await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, lastName: true, email: true } }).catch(() => null) : null;
    const now = new Date().toISOString();
    const item: TerminalRequest = {
      id: randomUUID().slice(0, 12), ...clean, status: 'open', reply: '', createdAt: now, updatedAt: now,
      byName: u ? ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null) : null,
    };
    await this.write(tenantId, [item, ...(await this.read(tenantId))]);
    await this.prisma.auditLog.create({
      data: { tenantId, userId: user.userId ?? null, action: 'payment.terminal_request', resourceType: 'tenant', resourceId: tenantId, metadata: { brand: item.brand, model: item.model, brandKey: item.brandKey } as never } as never,
    }).catch(() => undefined);
    return { item, driven: DRIVEN_BRANDS.includes(item.brandKey) };
  }

  // ---- platform (SUPER_ADMIN) ----

  async all() {
    const rows = await this.prisma.setting.findMany({ where: { key: TERMINAL_REQUESTS_KEY }, select: { tenantId: true, value: true }, take: 2000 }).catch(() => [] as { tenantId: string; value: unknown }[]);
    const ids = rows.map((r) => r.tenantId);
    const tenants = ids.length ? await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }).catch(() => []) : [];
    const name = new Map(tenants.map((t) => [t.id, t]));
    return rows
      .flatMap((r) => readRequests(r.value).map((x) => ({ ...x, tenantId: r.tenantId, salon: name.get(r.tenantId)?.name ?? '', slug: name.get(r.tenantId)?.slug ?? '' })))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 300);
  }

  async update(tenantId: string, id: string, dto: { status?: RequestStatus; reply?: string }) {
    const list = await this.read(tenantId);
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new NotFoundException('Request not found');
    const next = { ...list[i], updatedAt: new Date().toISOString() };
    if (dto.status === 'open' || dto.status === 'sent' || dto.status === 'done') next.status = dto.status;
    if (typeof dto.reply === 'string') next.reply = dto.reply.replace(/\r/g, '').trim().slice(0, 1000);
    list[i] = next;
    await this.write(tenantId, list);
    return next;
  }
}
