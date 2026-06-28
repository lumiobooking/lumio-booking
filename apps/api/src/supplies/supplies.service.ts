import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

export interface SupplyInput {
  name?: string;
  unit?: string;
  stockQty?: number;
  lowStockThreshold?: number;
  costCents?: number | null;
  supplier?: string | null;
  isActive?: boolean;
}

@Injectable()
export class SuppliesService {
  constructor(private readonly prisma: PrismaService) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** List supplies with a computed low-stock flag (active items at/under threshold). */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    const items = await this.prisma.supplyItem.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return items.map((i) => ({ ...i, lowStock: i.isActive && i.stockQty <= i.lowStockThreshold }));
  }

  async create(user: AuthenticatedUser, dto: SupplyInput) {
    const tenantId = this.tid(user);
    const item = await this.prisma.supplyItem.create({
      data: {
        tenantId,
        name: (dto.name ?? '').trim() || 'Untitled',
        unit: (dto.unit ?? 'unit').trim() || 'unit',
        stockQty: this.nonNeg(dto.stockQty, 0),
        lowStockThreshold: this.nonNeg(dto.lowStockThreshold, 0),
        costCents: typeof dto.costCents === 'number' && dto.costCents >= 0 ? Math.round(dto.costCents) : null,
        supplier: dto.supplier?.trim() || null,
        isActive: typeof dto.isActive === 'boolean' ? dto.isActive : true,
      },
    });
    return { ...item, lowStock: item.isActive && item.stockQty <= item.lowStockThreshold };
  }

  async update(user: AuthenticatedUser, id: string, dto: SupplyInput) {
    const tenantId = this.tid(user);
    await this.ensure(tenantId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || 'Untitled';
    if (dto.unit !== undefined) data.unit = dto.unit.trim() || 'unit';
    if (dto.stockQty !== undefined) data.stockQty = this.nonNeg(dto.stockQty, 0);
    if (dto.lowStockThreshold !== undefined) data.lowStockThreshold = this.nonNeg(dto.lowStockThreshold, 0);
    if (dto.costCents !== undefined) data.costCents = typeof dto.costCents === 'number' && dto.costCents >= 0 ? Math.round(dto.costCents) : null;
    if (dto.supplier !== undefined) data.supplier = dto.supplier?.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    await this.prisma.supplyItem.updateMany({ where: { id, tenantId }, data });
    return this.getOne(tenantId, id);
  }

  /** Receive (+) or use (−) stock. Quantity never drops below zero. */
  async adjust(user: AuthenticatedUser, id: string, delta: number) {
    const tenantId = this.tid(user);
    const item = await this.ensure(tenantId, id);
    const next = Math.max(0, item.stockQty + Math.round(delta || 0));
    await this.prisma.supplyItem.updateMany({ where: { id, tenantId }, data: { stockQty: next } });
    return this.getOne(tenantId, id);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tid(user);
    await this.ensure(tenantId, id);
    await this.prisma.supplyItem.deleteMany({ where: { id, tenantId } });
    return { id, deleted: true };
  }

  private async ensure(tenantId: string, id: string) {
    const item = await this.prisma.supplyItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Supply item not found');
    return item;
  }

  private async getOne(tenantId: string, id: string) {
    const item = await this.prisma.supplyItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Supply item not found');
    return { ...item, lowStock: item.isActive && item.stockQty <= item.lowStockThreshold };
  }

  private nonNeg(v: unknown, d: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : d;
  }
}
