/**
 * Who belongs in a technician picker (the calendar's "Dịch vụ & kỹ thuật viên",
 * the booking form, the till's per-service technician, a service's
 * technicians). A receptionist, a waiter or the kitchen never does — "tài
 * khoản lễ tân thì chỉ có nhiệm vụ lễ tân" — and neither does anyone the
 * owner marked as not taking appointments. The API enforces the same rule
 * (api staff/bookable-role.ts); this keeps them out of the lists.
 */
export const FRONT_ONLY_ROLES = ['RECEPTIONIST', 'WAITER', 'KITCHEN'];

export function isBookable(s: { isActive?: boolean | null; takesAppointments?: boolean | null; staffRole?: string | null } | null | undefined): boolean {
  if (!s) return false;
  if (s.isActive === false || s.takesAppointments === false) return false;
  return !FRONT_ONLY_ROLES.includes(String(s.staffRole ?? '').toUpperCase());
}

/** The bookable people, plus whoever is already picked (so the picker can still show the current choice). */
export function pickerStaff<T extends { id: string; isActive?: boolean | null; takesAppointments?: boolean | null; staffRole?: string | null }>(all: T[], keep: (string | null | undefined)[] = []): T[] {
  const want = new Set(keep.filter(Boolean) as string[]);
  return all.filter((s) => isBookable(s) || want.has(s.id));
}
