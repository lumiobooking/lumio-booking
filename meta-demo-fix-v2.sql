-- ===========================================================================
-- BẢN SỬA LẠI — nhắm đúng bằng ID, không lọc theo số điện thoại nữa.
--
-- Số 5125235123 đang gắn với NHIỀU hồ sơ khách, nên bản trước sửa lan sang
-- khách test khác. Bản này khoá cứng vào đúng 3 ID lấy từ KHỐI 1:
--
--   appointment : 33f8793c-c0fd-41e2-9656-f7eee97576be
--   customer    : c6229c7c-25ad-4af0-b6cb-39641054a2bc   (Anna)
--   tenant      : cee85e3d-fc4b-4925-bb39-c0f705ea9150
--
-- Mốc thời gian (UTC):
--   lịch hẹn diễn ra : 2026-07-30 20:00:00+00  (= 4:00 PM giờ tiệm)
--   khách nhắn/đặt   : 2026-07-29 20:30:00+00  (= 29/7, 4:30 PM giờ tiệm)
--   thu tiền + điểm  : 2026-07-30 20:35:00+00  (= 30/7, 4:35 PM giờ tiệm)
--
-- Chạy TỪNG KHỐI. Đọc SELECT rồi mới chạy UPDATE ngay dưới nó.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A1 — Hiện trạng của riêng Anna. Chạy trước để biết còn gì phải sửa.
-- ---------------------------------------------------------------------------
SELECT 'customer'    AS bang, c.id, c."createdAt" AS ngay FROM customers c
  WHERE c.id = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc'
UNION ALL
SELECT 'appointment', a.id, a."createdAt" FROM appointments a
  WHERE a.id = '33f8793c-c0fd-41e2-9656-f7eee97576be'
UNION ALL
SELECT 'payment', p.id, p."paidAt" FROM payments p
  WHERE p."appointmentId" = '33f8793c-c0fd-41e2-9656-f7eee97576be'
UNION ALL
SELECT 'loyalty', lt.id, lt."createdAt" FROM loyalty_transactions lt
  WHERE lt."customerId" = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc';


-- ---------------------------------------------------------------------------
-- A2 — Ngày tạo hồ sơ khách Anna  ->  29/7/2026
--      (chạy lại cũng không sao, chỉ ghi đè đúng 1 dòng)
-- ---------------------------------------------------------------------------
UPDATE customers
SET "createdAt" = '2026-07-29 20:30:00+00'
WHERE id = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc';


-- ---------------------------------------------------------------------------
-- A3 — Ngày tạo lịch hẹn  ->  29/7/2026
-- ---------------------------------------------------------------------------
UPDATE appointments
SET "createdAt" = '2026-07-29 20:30:00+00'
WHERE id = '33f8793c-c0fd-41e2-9656-f7eee97576be';


-- ---------------------------------------------------------------------------
-- A4 — Ngày thu tiền  ->  30/7/2026 4:35 PM
-- ---------------------------------------------------------------------------
UPDATE payments
SET "createdAt" = '2026-07-30 20:35:00+00',
    "paidAt"    = '2026-07-30 20:35:00+00'
WHERE "appointmentId" = '33f8793c-c0fd-41e2-9656-f7eee97576be';


-- ---------------------------------------------------------------------------
-- A5 — Ngày ghi điểm thưởng CỦA RIÊNG ANNA  ->  30/7/2026 4:35 PM
--      Khoá theo customerId, nên không đụng khách nào khác.
-- ---------------------------------------------------------------------------
UPDATE loyalty_transactions
SET "createdAt" = '2026-07-30 20:35:00+00'
WHERE "customerId" = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc';


-- ---------------------------------------------------------------------------
-- A6 — Kiểm tra lại. Cả 4 dòng phải nằm trong 29–30/7/2026.
-- ---------------------------------------------------------------------------
SELECT 'customer'    AS bang, c."createdAt" AS ngay FROM customers c
  WHERE c.id = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc'
UNION ALL
SELECT 'appointment', a."createdAt" FROM appointments a
  WHERE a.id = '33f8793c-c0fd-41e2-9656-f7eee97576be'
UNION ALL
SELECT 'payment', p."paidAt" FROM payments p
  WHERE p."appointmentId" = '33f8793c-c0fd-41e2-9656-f7eee97576be'
UNION ALL
SELECT 'loyalty', lt."createdAt" FROM loyalty_transactions lt
  WHERE lt."customerId" = 'c6229c7c-25ad-4af0-b6cb-39641054a2bc';


-- ===========================================================================
-- B — DỌN HẬU QUẢ của bản trước (18 dòng điểm thưởng bị đổi lan)
--
-- Bản trước đặt MỌI dòng điểm thưởng của các hồ sơ dùng số 5125235123 về
-- 2026-07-30 20:35. Dưới đây liệt kê những dòng KHÔNG phải của Anna để anh
-- nhìn rõ mức ảnh hưởng. Chúng chỉ sai NGÀY HIỂN THỊ — điểm và tiền nguyên vẹn.
-- ===========================================================================
SELECT c."firstName", c.id AS customer_id, COUNT(*) AS so_dong_bi_doi
FROM loyalty_transactions lt
JOIN customers c ON c.id = lt."customerId"
WHERE c.phone = '5125235123'
  AND c.id <> 'c6229c7c-25ad-4af0-b6cb-39641054a2bc'
  AND lt."createdAt" = '2026-07-30 20:35:00+00'
GROUP BY c."firstName", c.id;

-- Nếu muốn tách chúng ra khỏi ngày demo (đưa về hôm nay cho dễ phân biệt),
-- chạy dòng dưới. Không bắt buộc — đây là dữ liệu test.
-- UPDATE loyalty_transactions lt
-- SET "createdAt" = '2026-08-02 12:00:00+00'
-- FROM customers c
-- WHERE c.id = lt."customerId"
--   AND c.phone = '5125235123'
--   AND c.id <> 'c6229c7c-25ad-4af0-b6cb-39641054a2bc'
--   AND lt."createdAt" = '2026-07-30 20:35:00+00';
