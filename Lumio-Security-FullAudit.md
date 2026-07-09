# Lumio Booking — Rà soát bảo mật toàn hệ thống

_Ngày 09/07/2026 · Phạm vi: backend API (NestJS), web (Next.js), áp dụng cho MỌI ngành: nail salon, nhà hàng, và cổng Super Admin._

## Kết luận nhanh

Hệ thống được xây **vững về mặt kiến trúc bảo mật**. Rà soát sâu 3 hướng (cô lập tenant, phân quyền/khoá/webhook, thanh toán/secrets/injection) **không phát hiện lỗ hổng rò rỉ dữ liệu chéo giữa các salon, không có SQL injection, không có đường leo thang quyền**. Đã tìm và **vá 5 lỗ hổng hack thực tế** (quan trọng nhất là giả mạo webhook). Không cần migration DB — chỉ chạy `deploy.bat`.

---

## A. Những gì đã AN TOÀN sẵn (đã kiểm chứng, không phải phỏng đoán)

**1. Cô lập tenant (chống rò rỉ chéo — IDOR): AN TOÀN tuyệt đối.**
Mọi request đi qua một "điểm nghẹt" duy nhất (`common/tenant/tenant-context.ts`): `tenantId` lấy từ **JWT đã ký**, và hàm `resolveTenantScope` **từ chối** mọi ý đồ đổi sang tenant khác. Mọi truy vấn/ghi đều theo mẫu "kiểm tra rồi mới thao tác" (`findFirst({ id, tenantId })` → 404 nếu không thuộc mình → mới update/delete). Áp dụng nhất quán cho **tất cả** module: staff, services, tables, menu, bookings, customers, payments, POS, gift-cards, waitlist, walkins, settings, reviews, invoices… Một salon **không thể** đọc/sửa dữ liệu salon khác. Nhà hàng và tiệm nail dùng chung cơ chế này nên đều an toàn như nhau.

**2. Chuyển chi nhánh (chain):** không thể nhảy sang chi nhánh không thuộc quyền — `BranchScopeInterceptor` kiểm tra `canAccess` trước khi đổi scope; thu ngân/kỹ thuật viên bị loại khỏi quyền toàn nhóm.

**3. Phân quyền (RBAC): AN TOÀN.** Mọi route cấp nền tảng (tạo/khoá/xoá salon, quản lý gói, billing nền tảng, cấp quyền tính năng, quản lý hotline) đều có `@Roles(SUPER_ADMIN)`. Salon Admin chỉ thấy salon mình; Staff chỉ thấy booking được giao. **Không leo thang quyền**: `ValidationPipe` (whitelist + forbidNonWhitelisted) chặn mọi field lạ (role/tenantId/capabilities/billingExempt) → không thể tự nâng quyền qua body.

**4. API key (plugin WordPress): AN TOÀN.** Key ngẫu nhiên 192-bit, **băm SHA-256** khi lưu (không lưu bản gõ), hiện 1 lần lúc tạo, **thu hồi được**, có hạn dùng, tenant lấy từ key ở server. Không so sánh chuỗi thô.

**5. Thanh toán: AN TOÀN với client.** Số tiền luôn **tính ở server** (từ booking/plan/hoá đơn) — client không gửi được số tiền tuỳ ý. Không có endpoint công khai để "đánh dấu đã thanh toán". Trang hoá đơn công khai dùng **token khó đoán** (uuid), không phải id tuần tự. Webhook Stripe/PayPal có xác minh chữ ký.

**6. Injection & secrets: AN TOÀN.** Không có `queryRawUnsafe`/nối chuỗi SQL (chỉ 2 chỗ raw đều tham số hoá: khoá phiên đặt lịch + health-check). Secrets qua biến môi trường; API không lộ `passwordHash`/khoá cổng thanh toán ra frontend; không có khoá thật hard-code trong mã.

---

## B. 5 lỗ hổng đã VÁ lần này

| # | Mức | Lỗ hổng | Đã vá |
|---|-----|---------|-------|
| 1 | 🔴 **Critical** | **Webhook Twilio (hotline AI) không xác minh chữ ký.** Ai biết số hotline của salon có thể POST dữ liệu cuộc gọi giả → tạo booking thật, gửi SMS, chạy AI (đốt ngân sách), và **thổi phồng cước cuộc gọi**. | Thêm `TwilioSignatureGuard` xác minh `X-Twilio-Signature` trên mọi route `/voice/*`. Bật khi có `TWILIO_AUTH_TOKEN`. Nút tắt khẩn: `VOICE_VERIFY_SIGNATURE=false`. |
| 2 | 🟠 **High** | **Webhook Messenger không xác minh chữ ký.** Sự kiện giả có thể điều khiển bot AI gửi tin bằng token Page của salon + tạo booking + đốt ngân sách AI. | Xác minh `X-Hub-Signature-256` (HMAC-SHA256 bằng `FB_APP_SECRET`) trên raw body; sự kiện giả bị bỏ âm thầm. |
| 3 | 🟡 **Medium** | **XSS lưu trữ qua JSON-LD.** Salon đặt tên chứa `</script>...` sẽ chèn được mã chạy trên trang đặt chỗ của chính họ (hại khách của họ). | Escape `<` thành `<` trước khi nhúng. |
| 4 | 🟡 **Medium** | **JWT_SECRET có khoá dự phòng.** Nếu môi trường bị cấu hình sai (vd `NODE_ENV=prod`), khoá yếu được dùng → giả mạo được token admin. | Bắt buộc `JWT_SECRET` ở **mọi** môi trường trừ `development`; thiếu là dừng khởi động. |
| 5 | 🟢 **Low** | **Mã thẻ quà tặng dùng `Math.random()`** (đoán được). | Đổi sang `crypto.randomInt` (ngẫu nhiên mã hoá). |

---

## C. Khuyến nghị còn lại (nên làm, chưa khẩn cấp)

1. **Ghi audit log** cho: đăng nhập / đăng nhập thất bại, đổi khoá cổng thanh toán, hoá đơn được thanh toán. (Hệ thống đã log rất nhiều hành động quan trọng; đây là vài chỗ còn thiếu — spec yêu cầu log login.)
2. **Guard "fail-closed":** route nào thiếu `@Roles` hiện mặc định cho mọi user đã đăng nhập đi qua (an toàn hiện tại vì các route nhạy cảm đều có `@Roles`). Nên thêm test đảm bảo route mới không vô tình hở.
3. **Đặt cọc thật:** hiện dùng cổng "mock" (đánh dấu PAID nhưng không thu tiền). Khi muốn đặt cọc chống no-show thật, gắn Stripe cho luồng booking.
4. **Thêm DTO** cho vài endpoint đang nhận body dạng tự do (đổi tài khoản, lưu khoá cổng) — phòng xa.
5. **Nâng cấp khi mở rộng:** 2FA cho admin; Cloudflare (WAF + ẩn IP gốc); danh sách chặn token để "đăng xuất tức thì"; rate limit bằng Redis nếu chạy nhiều instance.

---

## D. Lưu ý khi deploy

- Chạy **`deploy.bat`**.
- **Hotline:** xác minh Twilio dựa trên `PUBLIC_API_URL`/`RENDER_EXTERNAL_URL` (đã cấu hình đúng). Nếu sau deploy hotline gặp trục trặc, đặt `VOICE_VERIFY_SIGNATURE=false` để tạm tắt rồi báo tôi.
- **Messenger:** xác minh chỉ bật khi có `FB_APP_SECRET` (đã có nếu bot đang chạy). Chưa cấu hình thì không ảnh hưởng.
- Không có migration DB.
