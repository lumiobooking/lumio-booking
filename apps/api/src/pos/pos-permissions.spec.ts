/**
 * The till's sensitive actions are the owner's to hand out, person by person:
 * a typed discount, voiding a paid ticket. Promo codes and loyalty points are
 * not "typed" and stay open to anyone who may check out.
 */
jest.mock('./pos.service', () => ({ PosService: class {} }));
// The device's generated client may predate these enums; the spec is about permissions, not the DTO.
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  OrderItemKind: { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
  PaymentMethod: { CASH: 'CASH', CARD: 'CARD', OTHER: 'OTHER' },
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPPORT: 'SUPPORT' },
  StaffRole: { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
}));
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PosController } from './pos.controller';
import { CAPS_KEY } from '../auth/decorators/caps.decorator';
import { hasCapability } from '../auth/capabilities';

const staff = (staffRole: string, staffCaps: string[] | null = null) => ({ userId: 'u', email: 'x', role: 'STAFF', tenantId: 't1', staffRole, staffCaps }) as any;
const owner = { userId: 'o', email: 'o', role: 'SALON_ADMIN', tenantId: 't1' } as any;

describe('counter permissions', () => {
  const created: unknown[] = [];
  const ctl = new PosController({ createOrder: async (_u: unknown, dto: unknown) => { created.push(dto); return { ok: true }; } } as never);

  it('a receptionist may give a discount by default; a person whose owner took it away may not', async () => {
    await expect(ctl.createOrder(staff('RECEPTIONIST'), { manualDiscountCents: 500, items: [], tenders: [] } as never)).resolves.toEqual({ ok: true });
    await expect(ctl.createOrder(staff('RECEPTIONIST', ['pos', 'orders']), { manualDiscountCents: 500, items: [], tenders: [] } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a promo code or points (no typed discount) is never blocked', async () => {
    await expect(ctl.createOrder(staff('RECEPTIONIST', ['pos']), { discountCents: 800, items: [], tenders: [] } as never)).resolves.toEqual({ ok: true });
  });

  it('owners always may', async () => {
    await expect(ctl.createOrder(owner, { manualDiscountCents: 5000, items: [], tenders: [] } as never)).resolves.toEqual({ ok: true });
  });

  it('voiding or deleting a ticket needs its own permission, which a receptionist does not start with', () => {
    const r = new Reflector();
    expect(r.get(CAPS_KEY, PosController.prototype.voidOrder)).toEqual(['pos.void']);
    expect(r.get(CAPS_KEY, PosController.prototype.removeOrder)).toEqual(['pos.void']);
    expect(hasCapability('STAFF' as never, 'RECEPTIONIST' as never, 'pos.void')).toBe(false);
    expect(hasCapability('STAFF' as never, 'MANAGER' as never, 'pos.void')).toBe(true);
    expect(hasCapability('STAFF' as never, 'RECEPTIONIST' as never, 'pos.void', ['pos', 'pos.void'])).toBe(true);
    expect(hasCapability('SALON_ADMIN' as never, null, 'pos.void')).toBe(true);
  });
});
