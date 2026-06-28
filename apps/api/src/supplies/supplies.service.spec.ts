import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SuppliesService } from './supplies.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

type Row = { id: string; tenantId: string; name: string; unit: string; stockQty: number; lowStockThreshold: number; costCents: number | null; supplier: string | null; isActive: boolean };

function makePrismaFake(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((s, i) => ({
    id: s.id ?? `s-${i + 1}`, tenantId: s.tenantId!, name: s.name ?? 'Item', unit: s.unit ?? 'unit',
    stockQty: s.stockQty ?? 0, lowStockThreshold: s.lowStockThreshold ?? 0, costCents: s.costCents ?? null,
    supplier: s.supplier ?? null, isActive: s.isActive ?? true,
  }));
  return {
    supplyItem: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.tenantId === where.tenantId)),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { id: `s-${rows.length + 1}`, ...data }; rows.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id && x.tenantId === where.tenantId); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
      deleteMany: jest.fn(async ({ where }: any) => { const i = rows.findIndex((x) => x.id === where.id && x.tenantId === where.tenantId); if (i >= 0) rows.splice(i, 1); return { count: i >= 0 ? 1 : 0 }; }),
    },
    _rows: rows,
  };
}

const salonA: AuthenticatedUser = { userId: 'u-a', email: 'a@x.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };

describe('SuppliesService tenant isolation', () => {
  it('list returns only the caller tenant items + computes lowStock', async () => {
    const prisma = makePrismaFake([
      { id: 'a1', tenantId: 'tenant-a', name: 'Acetone', stockQty: 1, lowStockThreshold: 5 },
      { id: 'b1', tenantId: 'tenant-b', name: 'Polish' },
    ]);
    const svc = new SuppliesService(prisma as any);

    const result = await svc.list(salonA);

    expect(result.map((r) => r.id)).toEqual(['a1']);
    expect(result[0].lowStock).toBe(true); // 1 <= 5
    expect(prisma.supplyItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
  });

  it('create stamps the caller tenantId', async () => {
    const prisma = makePrismaFake();
    const svc = new SuppliesService(prisma as any);

    await svc.create(salonA, { name: 'Powder', stockQty: 10 });

    expect(prisma.supplyItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a' }) }));
  });

  it('update on another tenant item returns 404', async () => {
    const prisma = makePrismaFake([{ id: 'b1', tenantId: 'tenant-b', name: 'Polish' }]);
    const svc = new SuppliesService(prisma as any);

    await expect(svc.update(salonA, 'b1', { name: 'Hacked' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.supplyItem.updateMany).not.toHaveBeenCalled();
  });

  it('adjust never drops stock below zero', async () => {
    const prisma = makePrismaFake([{ id: 'a1', tenantId: 'tenant-a', name: 'Acetone', stockQty: 2 }]);
    const svc = new SuppliesService(prisma as any);

    const out = await svc.adjust(salonA, 'a1', -5);
    expect(out.stockQty).toBe(0);
  });
});
