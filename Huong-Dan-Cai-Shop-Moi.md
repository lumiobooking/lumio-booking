# Cài đặt Lumio Booking cho một shop mới (bản nhúng)

> Làm theo thứ tự. Mỗi shop mới lặp lại checklist này. Kết quả: chủ tiệm **quản lý đặt lịch ngay trong WordPress** và **khách đặt lịch** trên website của họ.

Thông tin cố định của hệ thống:
- Trang chính / đăng nhập: **https://lumiobooking.com/login**
- Link đặt lịch của khách: **https://lumiobooking.com/book/{slug}**
- Plugin cài vào WordPress: **lumio-booking-0.4.1.zip** (bản nhúng dashboard)

---

## Bước 1 — Tạo tài khoản salon (tenant) cho shop

Chọn 1 trong 2:
- **Bạn tạo (Super Admin):** đăng nhập Super Admin → tạo tenant mới → đặt **Tên tiệm**, **slug** (vd `lux-nail-spa`), email + mật khẩu chủ tiệm, chọn **gói (plan)**.
- **Tiệm tự đăng ký:** vào `https://lumiobooking.com` → Start free trial → tạo tài khoản.

➡️ Ghi lại **slug** và **tài khoản đăng nhập salon admin** — sẽ dùng ở các bước sau.

## Bước 2 — Thiết lập tiệm trong Salon Admin

Đăng nhập `https://lumiobooking.com/login` bằng tài khoản salon, vào **Settings** và điền:
- **Company:** tên tiệm, địa chỉ, số điện thoại, email.
- **Business hours:** giờ mở/đóng từng ngày, ngày nghỉ.
- **Services:** dịch vụ + giá + thời lượng (có thể bấm **Import menu** dán cả bảng giá).
- **Staff:** thêm thợ (nếu chưa có thợ vẫn cho khách đặt được).
- **Payments:** chọn **tiền tệ** (USD/CAD...), bật "Pay at salon" và/hoặc cổng online.
- **Notifications:** bật email/SMS báo khi có booking (SMS cần Twilio đã đăng ký).
- **Branding:** màu + logo (tuỳ chọn).

➡️ Sau bước này, mở thử `https://lumiobooking.com/book/{slug}` xem trang đặt lịch đã có dịch vụ chưa.

## Bước 3 — Cài plugin vào WordPress của tiệm

1. Tải **lumio-booking-0.4.1.zip** (file tôi gửi trong chat).
2. WordPress admin của tiệm → **Plugins → Add New Plugin → Upload Plugin**.
3. Chọn file zip → **Install Now** → **Activate**.

> Nếu site đã có bản cũ: **Deactivate → Delete** bản cũ trước, rồi mới Upload bản mới (tránh trùng).

## Bước 4 — Kết nối plugin với tiệm

- Vào menu **Lumio Booking → Settings** (thanh trái wp-admin).
- **Booking site URL:** `https://lumiobooking.com`  *(để trống cũng được, mặc định đã là link này)*
- **Salon slug:** `{slug}` của tiệm (phần sau `/book/`).
- **Save settings** → bấm thử **"Your booking link"** để chắc chắn mở đúng.

## Bước 5 — Quản lý đặt lịch ngay trong WordPress

- Menu **Lumio Booking → Dashboard / Calendar / Bookings**.
- Lần đầu khung nhúng hỏi đăng nhập → dùng **tài khoản salon admin** của tiệm.
- Từ đây xem/duyệt/hủy/hoàn thành lịch, xem Customers, Payments, Waitlist, Staff, POS... **không cần rời WordPress**.

## Bước 6 — Đưa form đặt lịch cho khách

1. **Pages → Add New** → đặt tên ví dụ "Đặt lịch" / "Book Online".
2. Chèn shortcode: `[lumio_booking]`
   - Trình block: thêm khối **Shortcode** rồi gõ `[lumio_booking]`.
   - Chỉnh cao thấp nếu bị cắt: `[lumio_booking height="1000"]`
3. **Publish**.
4. Thêm trang này vào menu website: **Appearance → Menus**.

## Bước 7 — Kiểm tra (bắt buộc)

1. Mở trang "Đặt lịch" ở chế độ khách (hoặc tab ẩn danh) → đặt 1 lịch test bằng số ĐT của bạn.
2. Vào **Lumio Booking → Bookings** trong WordPress → thấy lịch test vừa tạo.
3. Kiểm tra email/SMS thông báo (nếu đã bật).
4. Xoá lịch test.

---

## Mẹo & xử lý nhanh
- **Khung nhúng trống / bắt đăng nhập hoài:** đăng nhập lại bằng tài khoản salon admin; đảm bảo dùng đúng tiệm.
- **Form khách báo "not configured":** chưa điền Salon slug ở Bước 4.
- **Sai slug:** slug viết thường, có gạch nối, đúng y phần sau `/book/`.
- **Tải chậm lần đầu:** server thức dậy vài giây (đã tối ưu); nếu quá chậm xem lại gói Render.
- **Cập nhật tính năng Lumio:** tự động hiện trong khung nhúng, **không cần cài lại plugin**.

## Tóm tắt 1 dòng cho mỗi shop
Tạo tenant → set Services/Hours/Payments → cài zip → Settings điền slug → quản lý ở menu Lumio Booking → dán `[lumio_booking]` lên 1 trang → test.
