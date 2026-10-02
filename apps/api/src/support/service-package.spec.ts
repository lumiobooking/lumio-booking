import { BadRequestException, NotFoundException } from '@nestjs/common';
import { isServicePackage, servicePackageOf, setServicePackage, SERVICE_PACKAGES } from './service-package';

describe('service package label', () => {
  it('knows the seven packages, each once, with a care tier', () => {
    const keys = SERVICE_PACKAGES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['social_care', 'boost', 'growth_map', 'scale', 'map_foundation', 'map_growth', 'map_authority']);
    for (const p of SERVICE_PACKAGES) expect([1, 2, 3, 4]).toContain(p.tier);
  });

  it('accepts a known key or a clear, nothing else', () => {
    expect(isServicePackage('scale')).toBe(true);
    expect(isServicePackage('')).toBe(true);
    for (const v of ['gold', null, undefined, 3]) expect(isServicePackage(v)).toBe(false);
  });

  it('reads what is stored, junk as none', () => {
    expect(servicePackageOf({ pkg: 'map_growth', at: 'x' })).toBe('map_growth');
    expect(servicePackageOf({ pkg: 'gold' })).toBe('');
    expect(servicePackageOf(null)).toBe('');
  });

  describe('setting it', () => {
    const user = { userId: 'u1', email: 'sp@lumio.test', role: 'SUPPORT' } as never;
    const make = () => {
      const prisma = {
        tenant: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'salon-a' ? { id: 'salon-a' } : null)) },
        setting: { upsert: jest.fn(async () => ({})) },
        auditLog: { create: jest.fn(async () => ({})) },
      };
      return { prisma, svc: { setTenantPackage: (u: never, id: string, k: unknown) => setServicePackage(prisma as never, u, id, k) } };
    };

    it('writes the label on that salon only, and audits it', async () => {
      const { prisma, svc } = make();
      await expect(svc.setTenantPackage(user, 'salon-a', 'scale')).resolves.toMatchObject({ servicePackage: 'scale' });
      const call = (prisma.setting.upsert.mock.calls[0] as any)[0];
      expect(call.where.tenantId_key).toEqual({ tenantId: 'salon-a', key: 'service_package' });
      expect(call.create.value.pkg).toBe('scale');
      expect((prisma.auditLog.create.mock.calls[0] as any)[0].data).toMatchObject({ tenantId: 'salon-a', action: 'support.service_package_set' });
    });

    it('refuses an unknown package and a salon that does not exist', async () => {
      const { prisma, svc } = make();
      await expect(svc.setTenantPackage(user, 'salon-a', 'gold')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.setTenantPackage(user, 'nope', 'scale')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });
  });
});
