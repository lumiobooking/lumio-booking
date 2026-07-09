# Lumio Booking — Báo cáo bảo mật & chống spam

_Ngày: 09/07/2026 · Phạm vi: backend API (NestJS) + trang đặt chỗ công khai_

## 1. Tóm tắt

Đã quét toàn bộ mặt tấn công của hệ thống và **triển khai một lớp chống spam nhiều tầng**
cùng vài bản vá bảo mật. Nền tảng vốn đã có phần khung tốt (cô lập tenant, xác thực,
kiểm tra dữ liệu đầu vào), nhưng **thiếu hoàn toàn giới hạn tần suất (rate limit)** — đây là
lỗ hổng lớn nhất để đối thủ spam đặt chỗ giả, dò mật khẩu, và đốt tiền SMS. Đã vá xong.

Không cần migration cơ sở dữ liệu. Chỉ cần chạy `deploy.bat`.

## 2. Đang an toàn sẵn (điểm mạnh có sẵn)

- **Cô lập tenant vững.** `tenantId` lấy từ JWT đã ký, không lấy từ client; mọi truy vấn
  đều scope theo tenant. Một salon không thể đọc/sửa dữ liệu salon khác.
- **Xác thực + phân quyền toàn cục.** Guard JWT chặn mọi route trừ route `@Public()`;
  RolesGuard phân quyền SUPER_ADMIN / SALON_ADMIN / STAFF.
- **Chống chèn dữ liệu rác.** `ValidationPipe` (whitelist + forbidNonWhitelisted) loại bỏ
  field lạ → chống mass-assignment.
- **Mật khẩu bcrypt 12 vòng.** Login trả lỗi chung "Invalid credentials" → không lộ email nào tồn tại.
- **Webhook có xác minh.** Stripe (chữ ký), PayPal (verify), Messenger (verify token).
- **Bí mật qua biến môi trường**, không hard-code; CORS giới hạn theo origin.

## 3. Đã triển khai lần này (chống spam nhiều lớp)

| Lớp | Cơ chế | Chi tiết |
|-----|--------|----------|
| 1 | **Rate limit theo IP** (toàn cục) | Bộ đếm cửa sổ trượt trong bộ nhớ. Mặc định 150 req/phút/IP mỗi route. |
| 2 | **Hạn mức chặt cho điểm nhạy cảm** | Đăng nhập **10/phút**; đặt chỗ **12/phút**; đăng ký **5/10 phút**. Vượt → HTTP 429. |
| 3 | **Giới hạn theo số điện thoại** | 1 SĐT tối đa **6 lần đặt online/24h** cho mỗi salon → chặn flood + đốt SMS. |
| 4 | **Honeypot** | Ô ẩn `website` trong form. Bot điền → giả vờ thành công nhưng **không tạo booking**. |
| 5 | **CAPTCHA (Cloudflare Turnstile)** | Đã đấu nối sẵn, **tắt mặc định**; bật bằng biến môi trường khi bị tấn công (xem mục 5). |
| 6 | **Bỏ qua throttle cho webhook** | Twilio (hotline) + Meta (messenger) không bị giới hạn — chúng gọi dồn hợp lệ. |

### Bản vá bảo mật kèm theo
- **Chặn cứng JWT ở production**: nếu thiếu `JWT_SECRET`, API dừng khởi động thay vì
  dùng khóa mặc định (trước đây có khóa dự phòng — nguy cơ giả mạo token).
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Strict-Transport-Security` (HTTPS) — tương đương helmet, không cần thư viện.

## 4. Chống được kịch bản gì của đối thủ?

- **Đặt bàn giả hàng loạt** → chặn bởi rate limit (12/phút/IP) + hạn mức SĐT (6/24h) + honeypot.
- **Đốt tiền SMS** (mỗi booking gửi 1 SMS) → cùng các lớp trên chặn trước khi tạo booking.
- **Dò mật khẩu admin (brute-force)** → login 10 lần/phút/IP là dừng.
- **Spam tài khoản đăng ký** → signup 5 lần/10 phút/IP + honeypot.
- **Bot script điền form** → honeypot + (khi bật) CAPTCHA.

## 5. Cách bật CAPTCHA thật khi cần (miễn phí)

Chỉ khi anh thực sự bị tấn công mạnh:
1. Tạo site ở Cloudflare Turnstile (miễn phí) → lấy **Site Key** + **Secret Key**.
2. Trên Render (API), thêm biến `TURNSTILE_SECRET = <secret key>`.
3. Trên web, thêm `NEXT_PUBLIC_TURNSTILE_SITE_KEY = <site key>` (tôi gắn widget vào form khi anh có key).
4. Từ đó, đặt chỗ/đăng ký/đăng nhập sẽ yêu cầu vượt CAPTCHA (thường vô hình).

Backend đã sẵn sàng: khi chưa đặt `TURNSTILE_SECRET`, tính năng **tắt hoàn toàn**, không ảnh hưởng khách.

## 6. Khuyến nghị nâng cấp thêm (khi mở rộng)

- **Redis cho rate limit** nếu API chạy nhiều instance (hiện 1 instance nên bộ nhớ là đủ).
- **Khóa tài khoản tạm** sau N lần sai mật khẩu (mạnh hơn rate limit cho brute-force có mục tiêu).
- **2FA cho Super Admin / Salon Admin.**
- **Cloudflare (WAF + proxy)** trước domain để chặn bot ở tầng mạng, ẩn IP gốc Render.
- **Honeypot cho form đặt lịch tiệm nail** (hiện đã có ở form nhà hàng; backend đã bảo vệ cả hai bằng rate limit + hạn mức SĐT).

## 7. Triển khai

Tất cả đã commit. Chạy **`deploy.bat`**. Render sẽ build lại API + web. Không có migration.
Sau khi deploy, thử đặt chỗ nhiều lần liên tục sẽ thấy bị chặn (HTTP 429) — đó là rate limit hoạt động.
