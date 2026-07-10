# Lumio — Rà soát ổn định hệ thống & an toàn dữ liệu

_Ngày 10/07/2026._

## 1. Dữ liệu có bị mất/đổi khi cập nhật không? → KHÔNG (đã kiểm chứng)

- **53 migration đều là "cộng thêm"** (thêm bảng/cột), **không có lệnh phá huỷ** nào (không DROP TABLE, không DROP COLUMN, không TRUNCATE, không reset). Tôi đã quét toàn bộ để xác nhận.
- Khi deploy, Render chạy **`prisma migrate deploy`** — lệnh này **chỉ áp các migration mới**, **không bao giờ xoá/reset dữ liệu**. Dữ liệu cũ giữ nguyên.
- Lệnh nguy hiểm (`migrate reset`, `db push --force-reset`) **không nằm trong quy trình deploy** → không tự chạy.

**Việc anh NÊN làm để an toàn tuyệt đối:**
1. **Bật sao lưu ở Neon** (database): trong dashboard Neon → bật **Point-in-Time Restore** (khôi phục về bất kỳ thời điểm nào trong quá khứ). Đây là "phao cứu sinh" nếu lỡ có sự cố.
2. **Trước mỗi thay đổi lớn về cấu trúc DB**, tạo một **Neon branch** (bản sao tức thời) để test migration trước khi chạy thật.
3. **Quy tắc vàng:** không bao giờ chạy lệnh có chữ `reset` / `force` trên database production.

## 2. Gói dịch vụ (Render) — đã ghim để không tụt về Free

- **API (lumio-api): `starter` (trả phí)** — không ngủ, không tụt về free. ✓
- **Web (lumio-web): vừa đổi từ `free` → `starter`.** Từ giờ mỗi lần deploy **sẽ không tự tụt xuống free** như anh từng bị với API. (Chi phí ~$7/tháng; sau khi chạy deploy, anh vào Render xác nhận thanh toán cho web service nếu được hỏi.)
- **Database (Neon):** nên dùng gói có backup/đủ compute; bật Point-in-Time Restore (mục 1).

> Lợi ích khi web ở gói trả phí: không bị "khởi động nguội" (khách mở link đặt lịch không phải chờ 30–50 giây), và cấu hình không bị reset khi deploy.

## 3. Các mục nên nâng cấp để chạy ổn định (ưu tiên)

| Ưu tiên | Mục | Vì sao | Việc cần làm |
|---------|-----|--------|--------------|
| 🔴 Cao | **Thanh toán đang ở chế độ "mock"** | Hệ thống đánh dấu ĐÃ THANH TOÁN nhưng **không trừ tiền thật** (cả đặt cọc lẫn thuê bao gói). | Gắn **Stripe thật** trước khi thu tiền khách. Tôi làm được khi anh có khóa Stripe. |
| 🔴 Cao | **Sao lưu database (Neon PITR)** | Phao cứu sinh khi sự cố/thao tác nhầm. | Bật trong dashboard Neon (mục 1). |
| 🟠 TB | **Giám sát lỗi (error monitoring)** | Hiện chưa có nơi tập trung xem lỗi production. | Gắn **Sentry** (miễn phí mức cơ bản) để nhận cảnh báo khi có lỗi. |
| 🟠 TB | **Giám sát uptime** | Biết ngay khi web/API sập. | Dùng UptimeRobot/BetterStack ping `/api/health` mỗi 5 phút. |
| 🟠 TB | **Ghi log đăng nhập & đổi khóa cổng thanh toán** | Bảo mật/tuân thủ (đã nêu ở báo cáo bảo mật). | Tôi thêm được nhanh. |
| 🟡 Thấp | **Rate limit dùng Redis** | Chỉ cần khi chạy **nhiều instance**. Hiện 1 instance nên bộ nhớ là đủ. | Để sau, khi mở rộng. |
| 🟡 Thấp | **Kết nối DB gộp (Neon pooler)** | Tránh cạn kết nối khi tải cao. | Dùng chuỗi kết nối **pooled** của Neon trong `DATABASE_URL`. |

## 4. Đã làm trong đợt này

- **3 gói chuẩn** (Starter $29 / Pro $69 / Premium $149) — nút **↺ Standard plans** trong Super Admin → Plans: 1 bấm xoá gói cũ + tạo đúng 3 gói mới. Có nút **Delete** cho từng gói.
- **Ghim gói web** ở Render (không tụt free).
- **Calendar:** chế độ **toàn màn hình** (cho quầy lễ tân) + **tìm khách theo tên/số điện thoại**.
- **Bookings:** ô tìm kiếm nay tìm được cả **số điện thoại**.

## 5. Việc cần làm ngay

1. Chạy **`deploy.bat`** (đợt này **không có migration** — chỉ code + cấu hình). Vào Render xác nhận web service lên **starter** nếu được hỏi.
2. Super Admin → Plans → bấm **↺ Standard plans** để chốt đúng 3 gói.
3. Bật **Neon Point-in-Time Restore** (an toàn dữ liệu).
4. (Khi sẵn sàng thu tiền) báo tôi để gắn **Stripe thật**.
