-- Restaurant staff roles: servers (table till) and kitchen (kitchen screen).
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'WAITER';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'KITCHEN';
