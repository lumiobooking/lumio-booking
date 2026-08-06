-- ===========================================================================
-- Đưa MỌI tiệm về mặc định feature-policy mới (ẩn AI + mục bảo mật).
-- Giá trị ghim per-tiệm (cột "featurePolicy") thắng mặc định trong code,
-- nên tiệm nào từng được chỉnh tay sẽ vẫn hiện đủ menu cho tới khi xóa ghim.
-- Chạy KHỐI 1 xem trước, rồi mới chạy KHỐI 2.
-- ===========================================================================

-- KHỐI 1 — Tiệm nào đang có ghim? (xem trước, không sửa gì)
SELECT id, name, slug, "featurePolicy"
FROM tenants
WHERE "featurePolicy" IS NOT NULL
  AND "featurePolicy"::text <> '{}'
ORDER BY name;

-- KHỐI 2 — Xóa ghim toàn bộ → mọi tiệm dùng mặc định mới (ẩn hết 9 mục).
-- Sau này muốn MỞ mục nào cho tiệm trả phí: Super Admin → tenant →
-- Feature access → chuyển key đó về 'salon' (sẽ tạo ghim mới, đúng ý).
UPDATE tenants
SET "featurePolicy" = NULL
WHERE "featurePolicy" IS NOT NULL;

-- KHỐI 3 — Kiểm tra lại: phải trả về 0 dòng.
SELECT id, name FROM tenants WHERE "featurePolicy" IS NOT NULL;
