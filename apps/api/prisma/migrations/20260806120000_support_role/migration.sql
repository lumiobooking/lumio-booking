-- Lumio setup staff: one account that enters salons via short-lived sessions.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPORT';
