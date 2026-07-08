-- Force re-login after a password change: any JWT issued before this instant is rejected.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
