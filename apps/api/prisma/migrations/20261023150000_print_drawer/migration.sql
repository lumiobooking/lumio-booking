-- Cash drawer: a print job may open the drawer plugged into its printer.
ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "drawer" BOOLEAN NOT NULL DEFAULT false;
