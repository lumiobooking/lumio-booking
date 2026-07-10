import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { BulkCreateStationDto, CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';

/**
 * Chairs / stations in a salon (Pedi spa chair, Mani table, Nail station) — the
 * physical spots the reception floor view is built on. Every query is scoped to
 * the caller's own tenantId so one salon can never see or touch another's chairs.
 */
@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  list(user: AuthenticatedUser) {
    return this.prisma.station.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateStationDto) {
    const tenantId = this.tenantId(user);
    const station = await this.prisma.station.create({
      data: {
        tenantId,
        name: dto.name.trim().slice(0, 40),
        kind: dto.kind ?? 'OTHER',
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station.created', resourceType: 'station', resourceId: station.id });
    return station;
  }

  /** Quick setup: add N chairs of one kind, auto-numbered after the existing ones. */
  async bulkCreate(user: AuthenticatedUser, dto: BulkCreateStationDto) {
    const tenantId = this.tenantId(user);
    const count = Math.max(1, Math.min(40, Math.round(dto.count || 0)));
    const existing = await this.prisma.station.count({ where: { tenantId } });
    const kind = dto.kind ?? 'OTHER';
    const prefix = (dto.prefix ?? '').trim().slice(0, 20);
    const data = Array.from({ length: count }, (_, i) => ({
      tenantId,
      kind,
      sortOrder: existing + i,
      name: prefix ? `${prefix} ${existing + i + 1}` : String(existing + i + 1),
    }));
    await this.prisma.station.createMany({ data });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station.bulk_created', resourceType: 'station', resourceId: tenantId });
    return this.list(user);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateStationDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.station.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Station not found');
    const station = await this.prisma.station.update({
      where: { id },
      data: {
        name: dto.name?.trim().slice(0, 40) ?? undefined,
        kind: dto.kind ?? undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station.updated', resourceType: 'station', resourceId: id });
    return station;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.station.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Station not found');
    await this.prisma.station.delete({ where: { id } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station.deleted', resourceType: 'station', resourceId: id });
    return { ok: true };
  }
}
