import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { BulkCreateStationDto, CreateStationDto, CreateStationTypeDto, UpdateStationTypeDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';

const TYPE_SELECT = { id: true, name: true, sortOrder: true };

/**
 * Chairs / stations in a salon, and the salon's own chair TYPES (Pedi, Mani,
 * Nail, or anything they define). The reception floor view is built on these.
 * Every query is scoped to the caller's own tenantId.
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

  // ---- Chair types (fully salon-managed) -----------------------------------
  /** The salon's chair types. Seeds a sensible default set the first time. */
  async listTypes(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    let types = await this.prisma.stationType.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    if (types.length === 0) {
      await this.prisma.stationType.createMany({ data: [
        { tenantId, name: 'Pedi', sortOrder: 0, keywords: 'pedi,pedicure,chân,chan,foot,spa' },
        { tenantId, name: 'Mani', sortOrder: 1, keywords: 'mani,manicure,tay,hand' },
        { tenantId, name: 'Nail', sortOrder: 2, keywords: 'nail,gel,dip,acrylic,bột,bot,fill,tip,shellac,powder,full set' },
      ] });
      types = await this.prisma.stationType.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    }
    return types;
  }

  async createType(user: AuthenticatedUser, dto: CreateStationTypeDto) {
    const tenantId = this.tenantId(user);
    const count = await this.prisma.stationType.count({ where: { tenantId } });
    const type = await this.prisma.stationType.create({ data: { tenantId, name: dto.name.trim().slice(0, 40), keywords: dto.keywords?.slice(0, 300) ?? null, sortOrder: count } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station_type.created', resourceType: 'station_type', resourceId: type.id });
    return type;
  }

  async updateType(user: AuthenticatedUser, id: string, dto: UpdateStationTypeDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.stationType.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Type not found');
    const type = await this.prisma.stationType.update({
      where: { id },
      data: { name: dto.name?.trim().slice(0, 40) ?? undefined, keywords: dto.keywords !== undefined ? (dto.keywords.slice(0, 300) || null) : undefined, sortOrder: dto.sortOrder ?? undefined, isActive: dto.isActive ?? undefined },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station_type.updated', resourceType: 'station_type', resourceId: id });
    return type;
  }

  async removeType(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.stationType.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Type not found');
    // Chairs of this type keep existing; their stationTypeId is set null (SetNull).
    await this.prisma.stationType.delete({ where: { id } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station_type.deleted', resourceType: 'station_type', resourceId: id });
    return { ok: true };
  }

  // ---- Chairs / stations ---------------------------------------------------
  list(user: AuthenticatedUser) {
    return this.prisma.station.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { stationType: { select: TYPE_SELECT } },
    });
  }

  async create(user: AuthenticatedUser, dto: CreateStationDto) {
    const tenantId = this.tenantId(user);
    const station = await this.prisma.station.create({
      data: {
        tenantId,
        name: dto.name.trim().slice(0, 40),
        stationTypeId: dto.stationTypeId || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      include: { stationType: { select: TYPE_SELECT } },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'station.created', resourceType: 'station', resourceId: station.id });
    return station;
  }

  /** Quick setup: add N chairs of one type, auto-numbered after the existing ones. */
  async bulkCreate(user: AuthenticatedUser, dto: BulkCreateStationDto) {
    const tenantId = this.tenantId(user);
    const count = Math.max(1, Math.min(40, Math.round(dto.count || 0)));
    const existing = await this.prisma.station.count({ where: { tenantId } });
    const prefix = (dto.prefix ?? '').trim().slice(0, 20);
    const data = Array.from({ length: count }, (_, i) => ({
      tenantId,
      stationTypeId: dto.stationTypeId || null,
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
        stationTypeId: dto.stationTypeId !== undefined ? (dto.stationTypeId || null) : undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
      include: { stationType: { select: TYPE_SELECT } },
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
