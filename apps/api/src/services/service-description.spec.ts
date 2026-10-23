import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ServicesService } from './services.service';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateServiceDto, SERVICE_DESCRIPTION_MAX } from './dto/create-service.dto';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * A salon could not save a long service note (labour-only pricing, consultation
 * rules…): the API capped it at 500 characters and the form gave no sign. Nor
 * could it clear one: an emptied box was sent as "nothing changed".
 */

const errorsOf = (cls: any, body: object) => validateSync(plainToInstance(cls, body) as object, { forbidNonWhitelisted: true, whitelist: true });

describe('service description length', () => {
  it('takes a real salon note of several hundred characters', () => {
    expect(SERVICE_DESCRIPTION_MAX).toBe(1000);
    expect(errorsOf(UpdateServiceDto, { description: 'x'.repeat(600) })).toHaveLength(0);
    expect(errorsOf(CreateServiceDto, { name: 'Weft install', priceCents: 2500, description: 'x'.repeat(1000) })).toHaveLength(0);
  });

  it('still refuses anything past the limit', () => {
    expect(errorsOf(UpdateServiceDto, { description: 'x'.repeat(1001) }).map((e) => e.property)).toEqual(['description']);
    expect(errorsOf(CreateServiceDto, { name: 'Weft install', priceCents: 2500, description: 'x'.repeat(1001) }).map((e) => e.property)).toEqual(['description']);
  });
});

function fakePrisma(rows: Array<{ id: string; tenantId: string; name: string; description: string | null }>) {
  const tx = {
    service: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && r.tenantId === where.tenantId);
        if (row) for (const [k, v] of Object.entries(data)) if (v !== undefined) (row as any)[k] = v;
        return { count: row ? 1 : 0 };
      }),
    },
    staffService: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  return {
    rows,
    tx,
    service: { findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null) },
    staffMember: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
}

const audit = { log: jest.fn(async () => undefined) };
const salonA: AuthenticatedUser = { userId: 'u-a', email: 'a@a.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };

describe('service description on update', () => {
  const seed = () => [
    { id: 'svc-a', tenantId: 'tenant-a', name: 'Weft install', description: 'Labor fee only.' },
    { id: 'svc-b', tenantId: 'tenant-b', name: 'Weft install', description: 'Other salon note' },
  ];

  it('an emptied box clears the note', async () => {
    const p = fakePrisma(seed());
    const out = await new ServicesService(p as any, audit as any).update(salonA, 'svc-a', { description: '   ' } as UpdateServiceDto);
    expect(p.tx.service.updateMany.mock.calls[0][0].data.description).toBeNull();
    expect(out.description).toBeNull();
  });

  it('saves a long note trimmed, and leaves it alone when not sent', async () => {
    const p = fakePrisma(seed());
    const svc = new ServicesService(p as any, audit as any);
    const note = '  ' + 'Consultation required. '.repeat(30).trim() + '  ';
    await svc.update(salonA, 'svc-a', { description: note } as UpdateServiceDto);
    expect(p.rows[0].description).toBe(note.trim());
    await svc.update(salonA, 'svc-a', { name: 'Weft install (full head)' } as UpdateServiceDto);
    expect(p.tx.service.updateMany.mock.calls[1][0].data.description).toBeUndefined();
    expect(p.rows[0].description).toBe(note.trim());
  });

  it('cannot touch another salon’s note', async () => {
    const p = fakePrisma(seed());
    await expect(new ServicesService(p as any, audit as any).update(salonA, 'svc-b', { description: '' } as UpdateServiceDto)).rejects.toBeInstanceOf(NotFoundException);
    expect(p.tx.service.updateMany).not.toHaveBeenCalled();
    expect(p.rows[1].description).toBe('Other salon note');
  });
});
