-- Till sales were written as PAID without "paidAt", and payroll, the sales
-- report and staff performance read sales by "paidAt" — so they counted none
-- of them. The code now stamps it; this fills in every ticket already paid,
-- dated when it was rung up. Idempotent: only rows still missing it.
UPDATE "orders" SET "paidAt" = "createdAt" WHERE "status" = 'PAID' AND "paidAt" IS NULL;
