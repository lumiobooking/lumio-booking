-- "Chờ thanh toán": customer finished, off the chair, waiting to pay (bill still open).
ALTER TABLE "walk_ins" ADD COLUMN "awaitingPayment" BOOLEAN NOT NULL DEFAULT false;
