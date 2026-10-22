import { brandKeyOf, cleanRequest, readRequests } from './terminal-requests';
import { TerminalRequestsService } from './terminal-requests.service';

describe('which card machine the salon has', () => {
  it('recognises the families by brand or model', () => {
    expect(brandKeyOf('Clover', 'Flex')).toBe('clover');
    expect(brandKeyOf('', 'GoDaddy Poynt Smart Terminal')).toBe('godaddy');
    expect(brandKeyOf('PAX', 'A920 Pro')).toBe('pax');
    expect(brandKeyOf('Square', 'Terminal')).toBe('square');
    expect(brandKeyOf('Dejavoo', 'P1')).toBe('dejavoo');
    expect(brandKeyOf('Something new', '')).toBe('other');
  });
  it('a request needs at least a brand or a model', () => {
    expect(cleanRequest({ brand: '  ', model: '' })).toBeNull();
    expect(cleanRequest({ brand: 'Clover', model: 'Mini', serial: ' C043UQ12345 ' })).toMatchObject({ brand: 'Clover', brandKey: 'clover', serial: 'C043UQ12345' });
  });
  it('stored junk is dropped', () => {
    expect(readRequests([{ id: 'a' }, null, 'x', { nope: 1 }])).toHaveLength(1);
    expect(readRequests('nope')).toEqual([]);
  });
});

describe('a salon only ever sees its own requests', () => {
  const rows: Record<string, unknown> = {};
  const prisma = {
    setting: {
      findUnique: async (a: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
        const v = rows[`${a.where.tenantId_key.tenantId}:${a.where.tenantId_key.key}`];
        return v ? { value: v } : null;
      },
      upsert: async (a: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => {
        rows[`${a.where.tenantId_key.tenantId}:${a.where.tenantId_key.key}`] = a.create.value;
        return {};
      },
    },
    auditLog: { create: async () => ({}) },
    user: { findUnique: async () => ({ firstName: 'Lan', lastName: null, email: 'x@y' }) },
  };
  const svc = new TerminalRequestsService(prisma as never);
  const A = { userId: 'u1', tenantId: 'tenant-A', role: 'SALON_ADMIN' } as never;
  const B = { userId: 'u2', tenantId: 'tenant-B', role: 'SALON_ADMIN' } as never;

  it('files the request under the caller\'s salon and answers with the brand', async () => {
    const r = await svc.create(A, { brand: 'Clover', model: 'Flex', serial: 'C04' });
    expect(r.item).toMatchObject({ brandKey: 'clover', status: 'open', byName: 'Lan' });
    expect(r.driven).toBe(false);
    expect((await svc.list(A)).map((x) => x.id)).toEqual([r.item.id]);
    expect(await svc.list(B)).toEqual([]);
  });
});
