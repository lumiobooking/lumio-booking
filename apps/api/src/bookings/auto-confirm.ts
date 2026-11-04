/**
 * Is a booking confirmed the moment it is made? Pure.
 *
 *  - Only a booking still waiting (PENDING / ASSIGNED) moves.
 *  - A salon whose technicians must accept in the app (staffMustAccept) keeps
 *    that step for a booking that has a technician — desk or customer alike.
 *  - The desk's own bookings: always (deskConfirm).
 *  - A customer's booking (page, plugin, chat, AI line): when the salon's
 *    "Tự động xác nhận" is on — the default; only an explicit `false` is off,
 *    so salons whose saved rules predate the switch are on.
 */
export interface ConfirmRules {
  autoConfirm?: boolean;
  staffMustAccept?: boolean;
}

export function shouldConfirmOnCreate(input: { customer: boolean; status: string; hasStaff: boolean; rules: ConfirmRules | null | undefined }): boolean {
  if (input.status !== 'PENDING' && input.status !== 'ASSIGNED') return false;
  if (input.hasStaff && input.rules?.staffMustAccept) return false;
  if (!input.customer) return true;
  // Rules could not be read: leave it for the desk — the switch may be off.
  if (!input.rules) return false;
  return input.rules.autoConfirm !== false;
}
