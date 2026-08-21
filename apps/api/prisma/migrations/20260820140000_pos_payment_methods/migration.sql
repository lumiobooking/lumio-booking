-- Distinct payment methods so a Vietnamese salon can tell its money apart.
--
-- Until now the till showed a Transfer button that was stored as OTHER, because
-- OTHER was the only value available. Harmless in the US where transfer is a
-- rare Zelle payment; ruinous in Vietnam, where VietQR, MoMo and ZaloPay would
-- all collapse into one bucket and "how much came in by MoMo" would have no
-- answer.
--
-- ADDITIVE ONLY. No existing row is touched and no value is removed, so every
-- historical OTHER row keeps counting exactly where it always did. The report
-- buckets in payment-methods.ts deliberately put TRANSFER and OTHER on the same
-- line, so the US end-of-day figures do not move by a cent on the day this
-- deploys.
--
-- IF NOT EXISTS because a re-run of a partially applied migration must not fail
-- the deploy; ADD VALUE is not transactional on older Postgres.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'VIETQR';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MOMO';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ZALOPAY';
