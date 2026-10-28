jest.mock('../auth/password.util', () => ({ hashSecret: jest.fn(async (s: string) => `hash:${s}`) }));
import { NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';

/**
 * "Tài khoản lễ tân thì chỉ có nhiệm vụ lễ tân" — a receptionist showed up in
 * the calendar's technician picker because she had once been saved as a
 * technician. Saving a person now lets the ROLE decide: a receptionist is
 * never bookable, whatever the form sends. Writes stay inside the salon.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(rows: Row[]) {
  const writes: Row[] = [];
  const tx = {
    staffMember: { updateMany: jest.fn(async ({ where, data }: Row) => { writes.push({ where, data }); return { count: rows.filter((r) => r.id === where.id && r.tenantId === where.tenantId).length }; }) },
    user: { updateMany: jest.fn(async () => ({ count: 1 })) },
    staffService: { deleteMany: jest.fn(), createMany: jest.fn() },
    staffWorkingHour: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    staffMember: { findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const svc = new StaffService(prisma as never, { log: jest.fn(async () => undefined) } as never, {} as never);
  return { svc, writes };
}
const owner = (t: string) => ({ userId: 'o', email: 'o@x', role: 'SALON_ADMIN', tenantId: t }) as never;

describe('saving a staff member: the front desk is never a technician', () => {
  it('technician → receptionist: no longer bookable (the "Le Tan" case)', async () => {
    const { svc, writes } = make([{ id: 'letan', tenantId: 'A', staffRole: 'TECHNICIAN', takesAppointments: true, userId: null, firstName: 'Le' }]);
    await svc.update(owner('A'), 'letan', { staffRole: 'RECEPTIONIST' } as never);
    expect(writes[0].data).toMatchObject({ staffRole: 'RECEPTIONIST', takesAppointments: false });
  });

  it('a receptionist cannot be switched on as bookable', async () => {
    const { svc, writes } = make([{ id: 'letan', tenantId: 'A', staffRole: 'RECEPTIONIST', takesAppointments: false, userId: null, firstName: 'Le' }]);
    await svc.update(owner('A'), 'letan', { takesAppointments: true } as never);
    expect(writes[0].data.takesAppointments).toBe(false);
  });

  it('a rename leaves the bookable flag alone', async () => {
    const { svc, writes } = make([{ id: 'lisa', tenantId: 'A', staffRole: 'TECHNICIAN', takesAppointments: false, userId: null, firstName: 'Lisa' }]);
    await svc.update(owner('A'), 'lisa', { firstName: 'Lisa M' } as never);
    expect(writes[0].data.takesAppointments).toBeUndefined();
  });

  it('cross-tenant: salon B cannot change salon A\'s person', async () => {
    const { svc, writes } = make([{ id: 'letan', tenantId: 'A', staffRole: 'TECHNICIAN', takesAppointments: true, userId: null, firstName: 'Le' }]);
    await expect(svc.update(owner('B'), 'letan', { staffRole: 'RECEPTIONIST' } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(writes).toHaveLength(0);
  });
});
