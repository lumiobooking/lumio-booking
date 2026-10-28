jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, StaffRole: actual.StaffRole?.RECEPTIONIST ? actual.StaffRole : { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN', WAITER: 'WAITER', KITCHEN: 'KITCHEN' } };
});
import { isFrontOnly, takesAppointmentsFor } from './bookable-role';

const R = { MANAGER: 'MANAGER', RECEPTIONIST: 'RECEPTIONIST', TECHNICIAN: 'TECHNICIAN', WAITER: 'WAITER', KITCHEN: 'KITCHEN' } as const;

describe('a receptionist is never a technician', () => {
  it('front-desk roles are never bookable, whatever the form sends', () => {
    for (const r of [R.RECEPTIONIST, R.WAITER, R.KITCHEN]) {
      expect(isFrontOnly(r)).toBe(true);
      expect(takesAppointmentsFor(r as never, true)).toBe(false);
      expect(takesAppointmentsFor(r as never, undefined, { role: R.TECHNICIAN as never, takes: true })).toBe(false);
    }
  });

  it('a technician made receptionist stops being bookable (the "Le Tan" in the picker)', () => {
    expect(takesAppointmentsFor(R.RECEPTIONIST as never, undefined, { role: R.TECHNICIAN as never, takes: true })).toBe(false);
  });

  it('technicians default on; the owner can switch one off; a manager only when switched on', () => {
    expect(takesAppointmentsFor(R.TECHNICIAN as never, undefined)).toBe(true);
    expect(takesAppointmentsFor(R.TECHNICIAN as never, false)).toBe(false);
    expect(takesAppointmentsFor(R.MANAGER as never, undefined)).toBe(false);
    expect(takesAppointmentsFor(R.MANAGER as never, true)).toBe(true);
    expect(takesAppointmentsFor(R.MANAGER as never, undefined, { role: R.MANAGER as never, takes: true })).toBe(true);
  });

  it('a receptionist moved to technician becomes bookable', () => {
    expect(takesAppointmentsFor(R.TECHNICIAN as never, undefined, { role: R.RECEPTIONIST as never, takes: false })).toBe(true);
  });
});
