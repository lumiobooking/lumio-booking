import type { StaffRole } from '@prisma/client';

/**
 * Who can be booked as a technician, by role.
 *
 * "Tài khoản lễ tân thì chỉ có nhiệm vụ lễ tân" — a receptionist (and a
 * waiter or the kitchen in a restaurant) is never a technician: never in a
 * technician picker, never auto-assigned, never a calendar column. Before,
 * `takesAppointments` was only a default from the role, so a person created
 * as a technician and later made receptionist stayed bookable and showed up
 * under "Dịch vụ & kỹ thuật viên".
 *
 * A technician is bookable unless the owner switched it off; a manager (an
 * owner who also does nails) only when the owner switches it on.
 */
// Plain strings, not the generated enum: this runs at import time, and the rule
// must not depend on how recent the generated client is.
export const FRONT_ONLY_ROLES: string[] = ['RECEPTIONIST', 'WAITER', 'KITCHEN'];

export function isFrontOnly(role: StaffRole | string | null | undefined): boolean {
  return !!role && FRONT_ONLY_ROLES.includes(String(role));
}

/**
 * The `takesAppointments` to store. `requested` is what the form sent
 * (undefined = not touched); `current` the stored value on an update.
 */
export function takesAppointmentsFor(
  role: StaffRole,
  requested: boolean | undefined,
  current?: { role: StaffRole; takes: boolean },
): boolean {
  if (isFrontOnly(role)) return false;
  if (requested !== undefined) return requested;
  // Moved from the front desk to the floor: now a technician, bookable.
  if (current && isFrontOnly(current.role)) return role === 'TECHNICIAN';
  if (current) return current.takes;
  return role === 'TECHNICIAN';
}
