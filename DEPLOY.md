# Đưa Lumio Booking lên online (Render) — Hướng dẫn

> Mục tiêu: chạy hệ thống thật trên Internet để test & tối ưu. Sau khi cài 1 lần,
> mỗi lần sửa code ở máy bạn chỉ cần **double‑click `deploy.bat`** → Render tự build lại.

## Kiến trúc khi chạy online
- **lumio-api** — backend NestJS (đường dẫn `/api`), chạy trên Render.
- **lumio-web** — dashboard + trang booking (Next.js), chạy trên Render.
- **Database** — PostgreSQL trên **Neon** (đã có sẵn của bạn).
- File `render.yaml` ở thư mục gốc khai báo sẵn cả 2 service → Render đọc và tạo tự động.

---

## Chuẩn bị (1 lần)
1. **Git** đã cài trên máy: https://git-scm.com/download/win
2. Tài khoản **GitHub** (bạn đã có).
3. Tài khoản **Render**: đăng ký miễn phí tại https://render.com (đăng nhập bằng GitHub cho nhanh).
4. **Chuỗi kết nối Neon (DATABASE_URL)**: vào https://console.neon.tech → project của bạn → *Connection string* → copy dạng:
   `postgresql://USER:PASSWORD@HOST/DB?sslmode=require`
   (nhớ có `?sslmode=require` ở cuối).

---

## Bước 1 — Tạo repo trên GitHub
1. Vào https://github.com/new
2. Repository name: `lumio-booking` (Private cũng được).
3. **KHÔNG** tick "Add a README / .gitignore / license" (để repo trống).
4. Create repository → copy URL dạng `https://github.com/<tên-bạn>/lumio-booking.git`

## Bước 2 — Đẩy code lên GitHub (lần đầu)
1. Double‑click **`deploy.bat`** trong thư mục dự án.
2. Lần đầu nó sẽ hỏi **Repo URL** → dán URL ở Bước 1.
3. Nó hỏi email/tên cho commit → nhập.
4. Lần push đầu có thể hiện cửa sổ **đăng nhập GitHub** → đăng nhập 1 lần.
5. Xong: code đã nằm trên GitHub.

## Bước 3 — Tạo dịch vụ trên Render bằng Blueprint
1. Vào https://dashboard.render.com → **New +** → **Blueprint**.
2. **Connect** tới repo `lumio-booking` vừa tạo.
3. Render đọc `render.yaml` và hiện 2 service: `lumio-api`, `lumio-web`.
4. Render sẽ hỏi các biến để trống (**sync:false**). Điền như sau:

   | Service | Biến | Giá trị nhập |
   |---|---|---|
   | lumio-api | `DATABASE_URL` | chuỗi Neon (có `?sslmode=require`) |
   | lumio-api | `CORS_ORIGINS` | `https://lumio-web.onrender.com` |
   | lumio-web | `NEXT_PUBLIC_API_URL` | `https://lumio-api.onrender.com/api` |

   > 2 URL trên là tên mặc định theo service. Nếu Render báo tên đã bị dùng và thêm hậu tố,
   > bạn cứ tạo trước, rồi ở **Bước 5** chỉnh lại cho khớp URL thật.

5. Bấm **Apply**. Render bắt đầu build cả 2 (lần đầu ~5–10 phút). Quá trình build của API tự
   chạy **migration** → tạo bảng trong Neon.

## Bước 4 — Tạo dữ liệu mẫu (1 lần, tùy chọn)
Để có sẵn Super Admin + 2 salon demo, chạy seed một lần từ máy bạn trỏ vào Neon:

```cmd
cd /d "D:\Phan mem Lumio\Booking\apps\api"
set DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
npm run db:seed
```
Tài khoản mẫu (đổi mật khẩu sau khi lên thật):
- Super Admin: `superadmin@lumio.test` / `Password123!`
- Salon A admin: `admin@salon-a.test` / `Password123!`
- Salon A staff: `staff@salon-a.test` / `Password123!`

## Bước 5 — Kiểm tra & sửa URL nếu cần
1. Mở `https://lumio-api.onrender.com/api/health` → thấy phản hồi OK là API sống.
2. Mở `https://lumio-web.onrender.com` → đăng nhập admin.
3. Nếu URL thật khác tên mặc định, vào Render:
   - `lumio-api` → Environment → sửa `CORS_ORIGINS` = URL web thật → Save.
   - `lumio-web` → Environment → sửa `NEXT_PUBLIC_API_URL` = URL api thật + `/api` → Save.
   - Với `lumio-web`, bấm **Manual Deploy → Clear build cache & deploy** (vì URL API được "nướng" vào lúc build).
4. Trang booking khách: `https://lumio-web.onrender.com/book/salon-a`

---

## Cập nhật về sau (mỗi lần sửa code)
Chỉ cần **double‑click `deploy.bat`** → nhập 1 dòng mô tả → Enter.
Code được push lên GitHub, Render tự build lại và cập nhật online. Theo dõi ở
https://dashboard.render.com

## Lưu ý gói Free của Render
- Service **ngủ sau ~15 phút** không ai dùng; lần truy cập đầu sau khi ngủ sẽ **chậm ~30–60 giây** (cold start). Test cá nhân thì ổn; chạy thật cho khách nên nâng gói trả phí để luôn bật.
- Đổi biến `NEXT_PUBLIC_API_URL` thì phải **deploy lại web** (clear cache) mới có hiệu lực.

## WordPress plugin (nếu dùng)
Trong cấu hình plugin, trỏ API endpoint về `https://lumio-api.onrender.com/api` và dán License/API key của salon. Mỗi site WordPress nối đúng 1 salon.

## Bảo mật khi lên thật
- Đổi toàn bộ mật khẩu demo.
- `JWT_SECRET` đã được Render tự sinh ngẫu nhiên — không cần đụng.
- Mọi secret (Neon URL, Stripe, Twilio, SMTP) chỉ đặt trong **Environment của Render**, không commit vào code (`.env` đã bị `.gitignore`).
