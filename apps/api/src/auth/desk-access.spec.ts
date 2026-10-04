/**
 * "Tính tiền của lễ tân bấm vào bị lỗi — có máy vào được, có máy không."
 *
 * Two causes, both fixed here: the till read owner-only endpoints, and what a
 * staff token said it could open was frozen at sign-in. The desk endpoints
 * now admit desk roles (with the owner's fields stripped), and a session's
 * permissions come from the database row, not from the token's age.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPPORT: 'SUPPORT' },
  StaffRole: { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN' },
}));
jest.mock('../pos/pos.service', () => ({ PosService: class {} }));
jest.mock('../auth/password.util', () => ({ hashSecret: async () => 'x' }));
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CAPS_KEY } from './decorators/caps.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { StaffController, stripForDesk } from '../staff/staff.controller';
import { SettingsController } from '../settings/settings.controller';
import { ServicesController } from '../services/services.controller';

const r = new Reflector();
const caps = (fn: unknown) => r.get(CAPS_KEY, fn as never);
const roles = (fn: unknown) => r.get(ROLES_KEY, fn as never);

describe('what the desk reads', () => {
  it('/settings, /staff and the add-on list admit desk roles', () => {
    expect(roles(SettingsController.prototype.get)).toContain('STAFF');
    expect(caps(SettingsController.prototype.get)).toEqual(expect.arrayContaining(['pos', 'calendar', 'bookings', 'walkins']));
    expect(roles(StaffController.prototype.list)).toContain('STAFF');
    expect(caps(StaffController.prototype.list)).toEqual(expect.arrayContaining(['pos', 'calendar', 'walkins']));
    expect(roles(ServicesController.prototype.listAllAddons)).toContain('STAFF');
    expect(caps(ServicesController.prototype.listAllAddons)).toContain('pos');
  });

  it('a staff account gets the desk view of settings, the owner gets everything', async () => {
    const { SettingsService } = await import('../settings/settings.service');
    const full = { company: { name: 'Glow' }, booking: { currency: 'USD' }, pos: { taxRatePercent: 8 }, loyalty: {}, branding: {}, gateways: { stripe: 'sk_live' }, notifications: { twilio: 'x' }, gmailRedirectUri: 'u', reminders: {} };
    const svc = Object.create(SettingsService.prototype);
    svc.get = async () => full;
    const ctl = new SettingsController(svc);
    const desk: any = await ctl.get({ role: 'STAFF', userId: 'u', tenantId: 't1' } as never);
    expect(desk.company).toEqual({ name: 'Glow' });
    expect(desk.pos).toEqual({ taxRatePercent: 8 });
    expect(desk.gateways).toBeUndefined();
    expect(desk.notifications).toBeUndefined();
    expect(desk.gmailRedirectUri).toBeUndefined();
    const owner: any = await ctl.get({ role: 'SALON_ADMIN', userId: 'o', tenantId: 't1' } as never);
    expect(owner.gateways).toBeDefined();
  });

  it('the desk sees who works here, never what they earn or how they sign in', async () => {
    const row = { id: 'kim', firstName: 'Kim', isActive: true, staffRole: 'TECHNICIAN', takesAppointments: true, staffServices: [], workingHours: [], tipQrUrl: null, commissionPercent: 60, hourlyRateCents: 2000, payType: 'HOURLY', user: { email: 'kim@x' }, email: 'k@x', phone: '1', permissions: ['pos'] };
    const out = stripForDesk(row);
    expect(Object.keys(out).sort()).toEqual(['firstName', 'id', 'isActive', 'staffRole', 'staffServices', 'takesAppointments', 'tipQrUrl', 'workingHours']);
    const ctl = new StaffController({ list: async () => [row] } as never);
    const forOwner: any = await ctl.list({ role: 'SALON_ADMIN', userId: 'o', tenantId: 't1' } as never);
    expect(forOwner[0].commissionPercent).toBe(60);
    const forDesk: any = await ctl.list({ role: 'STAFF', staffRole: 'RECEPTIONIST', userId: 'u', tenantId: 't1' } as never);
    expect(forDesk[0].commissionPercent).toBeUndefined();
    const forManager: any = await ctl.list({ role: 'STAFF', staffRole: 'MANAGER', userId: 'u', tenantId: 't1' } as never);
    expect(forManager[0].commissionPercent).toBe(60);
  });
});

describe('a session reads its permissions from the row, not from the token', () => {
  const make = (row: Record<string, unknown> | null, fail = false) => {
    const prisma: any = { user: { findUnique: async () => { if (fail) throw new Error('db'); return row; } } };
    const config: any = { get: () => 'secret' };
    return new JwtStrategy(config, prisma);
  };
  const base = { sub: 'u1', email: 'r@x', role: 'STAFF', tenantId: 't1', iat: Math.floor(Date.now() / 1000) } as any;

  it('an old token with no role still opens the till once the row says receptionist', async () => {
    const s = make({ isActive: true, passwordChangedAt: null, role: 'STAFF', staffMember: { staffRole: 'RECEPTIONIST', permissions: null } });
    const u = await s.validate({ ...base });
    expect(u.staffRole).toBe('RECEPTIONIST');
    expect(u.staffCaps).toBeNull();
  });

  it("the owner's per-person list applies even to a token minted before the change", async () => {
    const s = make({ isActive: true, passwordChangedAt: null, role: 'STAFF', staffMember: { staffRole: 'RECEPTIONIST', permissions: ['pos', 'reports', 'billing'] } });
    const u = await s.validate({ ...base, staffRole: 'TECHNICIAN', staffCaps: [] });
    expect(u.staffRole).toBe('RECEPTIONIST');
    expect(u.staffCaps).toEqual(['pos', 'reports']); // owner-only 'billing' dropped
  });

  it('when the database cannot answer, the token stands — nobody is signed out on a blip', async () => {
    const s = make(null, true);
    const u = await s.validate({ ...base, staffRole: 'RECEPTIONIST', staffCaps: ['pos'] });
    expect(u.staffRole).toBe('RECEPTIONIST');
    expect(u.staffCaps).toEqual(['pos']);
  });
});
