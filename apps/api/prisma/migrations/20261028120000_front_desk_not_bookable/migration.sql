-- A receptionist, a waiter or the kitchen is never a technician: they must not
-- appear in any technician picker or be auto-assigned. Before, the flag only
-- defaulted from the role, so a person created as a technician and later made
-- receptionist stayed bookable. Data only; the API now keeps it this way.
UPDATE "staff_members"
SET "takesAppointments" = false
WHERE "staffRole" IN ('RECEPTIONIST', 'WAITER', 'KITCHEN') AND "takesAppointments" = true;
