-- ===========================================================================
-- Đồng bộ dấu thời gian cho lịch demo Messenger (Anna · 5125235123)
--
-- Mục tiêu: ngày tạo hồ sơ khách + ngày ghi điểm thưởng + ngày tạo lịch khớp
-- với câu chuyện trong đoạn chat: hỏi ngày 29/7, hẹn 30/7 lúc 4:00 PM.
--
-- Múi giờ: lịch hẹn đang là 2026-07-30 20:00:00+00 (= 4:00 PM giờ tiệm).
--          Mọi mốc dưới đây viết theo UTC cho khỏi nhầm.
--
-- CÁCH DÙNG: chạy từng KHỐI một. Đọc kết quả SELECT, xác nhận đúng dòng,
--            rồi mới chạy UPDATE ngay bên dưới nó.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- KHỐI 1 — Xem lịch hẹn và khách. Ghi lại tenantId, id lịch, id khách.
-- ---------------------------------------------------------------------------
SELECT
  a.id            AS appointment_id,
  a."tenantId"    AS tenant_id,
  a."customerId"  AS customer_id,
  a."startTime",
  a."createdAt"   AS appointment_created,
  a.source,
  a.status,
  c."firstName",
  c.phone,
  c."createdAt"   AS customer_created
FROM appointments a
JOIN customers c ON c.id = a."customerId"
WHERE c.phone = '5125235123'
  AND a."startTime" BETWEEN '2026-07-30 00:00:00+00' AND '2026-07-31 00:00:00+00';


-- ---------------------------------------------------------------------------
-- KHỐI 2 — Ngày TẠO LỊCH: đặt về 29/7 (hôm khách nhắn Messenger).
--          2026-07-29 20:30:00+00 = 29/7 lúc 4:30 PM giờ tiệm.
-- ---------------------------------------------------------------------------
UPDATE appointments a
SET "createdAt" = '2026-07-29 20:30:00+00'
FROM customers c
WHERE c.id = a."customerId"
  AND c.phone = '5125235123'
  AND a."startTime" BETWEEN '2026-07-30 00:00:00+00' AND '2026-07-31 00:00:00+00';


-- ---------------------------------------------------------------------------
-- KHỐI 3 — Ngày TẠO HỒ SƠ KHÁCH ("since ..."): cùng ngày khách nhắn.
--          Chỉ đụng đúng khách này, trong đúng tiệm của lịch trên.
-- ---------------------------------------------------------------------------
UPDATE customers
SET "createdAt" = '2026-07-29 20:30:00+00'
WHERE phone = '5125235123'
  AND id IN (
    SELECT a."customerId" FROM appointments a
    WHERE a."startTime" BETWEEN '2026-07-30 00:00:00+00' AND '2026-07-31 00:00:00+00'
  );


-- ---------------------------------------------------------------------------
-- KHỐI 4 — Xem các dòng TIỀN của lịch này trước khi sửa.
-- ---------------------------------------------------------------------------
SELECT p.id, p."amountCents", p.status, p.type, p."createdAt", p."paidAt"
FROM payments p
JOIN appointments a ON a.id = p."appointmentId"
JOIN customers c    ON c.id = a."customerId"
WHERE c.phone = '5125235123'
  AND a."startTime" BETWEEN '2026-07-30 00:00:00+00' AND '2026-07-31 00:00:00+00';


-- ---------------------------------------------------------------------------
-- KHỐI 5 — Ngày THU TIỀN: 2026-07-30 20:35:00+00 = 4:35 PM, ngay sau buổi làm.
-- ---------------------------------------------------------------------------
UPDATE payments p
SET "createdAt" = '2026-07-30 20:35:00+00',
    "paidAt"    = '2026-07-30 20:35:00+00'
FROM appointments a, customers c
WHERE a.id = p."appointmentId"
  AND c.id = a."customerId"
  AND c.phone = '5125235123'
  AND a."startTime" BETWEEN '2026-07-30 00:00:00+00' AND '2026-07-31 00:00:00+00';


-- ---------------------------------------------------------------------------
-- KHỐI 6 — Ngày GHI ĐIỂM THƯỞNG ("Loyalty history"): cùng lúc thu tiền.
-- ---------------------------------------------------------------------------
UPDATE loyalty_transactions lt
SET "createdAt" = '2026-07-30 20:35:00+00'
FROM customers c
WHERE c.id = lt."customerId"
  AND c.phone = '5125235123';


-- ---------------------------------------------------------------------------
-- KHỐI 7 — Kiểm tra lại. Cả 4 mốc phải nằm trong 29–30/7/2026.
-- ---------------------------------------------------------------------------
SELECT 'appointment' AS what, a."createdAt" AS at FROM appointments a
  JOIN customers c ON c.id = a."customerId"
  WHERE c.phone = '5125235123'
UNION ALL
SELECT 'customer', c."createdAt" FROM customers c WHERE c.phone = '5125235123'
UNION ALL
SELECT 'payment', p."paidAt" FROM payments p
  JOIN appointments a ON a.id = p."appointmentId"
  JOIN customers c ON c.id = a."customerId"
  WHERE c.phone = '5125235123'
UNION ALL
SELECT 'loyalty', lt."createdAt" FROM loyalty_transactions lt
  JOIN customers c ON c.id = lt."customerId"
  WHERE c.phone = '5125235123';
