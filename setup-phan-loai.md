# Phân loại mục setup — Cơ bản / Chuyên sâu / Giấu hẳn

Nguyên tắc: khách mua SaaS không thấy code backend. Thứ lộ được là **giao diện cấu hình** — càng nhiều ô chỉnh càng lộ bản thiết kế. Vậy: tiệm chỉ thấy cái họ CẦN CHỈNH; cái thể hiện "cách hệ thống nghĩ" chuyển về Super Admin hoặc ẩn sau feature-policy (`platform`).

Ba mức:
- **CƠ BẢN** — hiện luôn, tiệm tự quản (mode `salon`).
- **CHUYÊN SÂU** — mặc định ẨN (`platform`), Super Admin bật per-tiệm khi bán add-on. Cơ chế feature-policy ĐÃ CÓ SẴN, chỉ thêm key.
- **GIẤU HẲN** — không bao giờ có UI phía salon; tham số nằm ở Super Admin portal / server. Tiệm chỉ thấy công tắc hoặc kết quả.

## 1. Vận hành hằng ngày — CƠ BẢN (giữ nguyên)

| Mục | Ghi chú |
|---|---|
| Calendar, Bookings, Walk-ins · Turns, Waitlist | Nghiệp vụ lõi |
| POS / Checkout, Orders, Card transactions | Thu tiền hằng ngày |
| Customers, Gift cards, Recycle bin | Dữ liệu của tiệm |
| Services, Products, Inventory, Staff | Danh mục tiệm tự nhập |
| Reports (tổng quan) | Chỉ số kết quả — không lộ công thức |
| Billing, Account, Connections (WordPress/QR) | Tài khoản & kết nối |

## 2. Settings (9 tab hiện tại)

| Tab | Đề xuất | Lý do |
|---|---|---|
| Company, Hours, Days off, Branding | CƠ BẢN | Bắt buộc để chạy tiệm |
| Notifications, Reminders + Rebooking | CƠ BẢN | Chỉ bật/tắt + số giờ; không lộ logic |
| Payments (phương thức, phí thẻ) | CƠ BẢN | Tiệm phải tự chọn |
| Loyalty / Referral (trong tab Payments) | CƠ BẢN nhưng RÚT GỌN | Giữ bật/tắt + điểm/$; các ngưỡng chống lạm dụng chuyển Giấu hẳn |
| Rules (lead time, advance days, chọn thợ) | CƠ BẢN | Chuẩn ngành, không phải bí mật |
| **Auto-assignment** (trong Rules) | GIỮ CÔNG TẮC, tham số GIẤU HẲN | Công tắc on/off ở lại; trọng số xếp thợ / rotation / skill-matching không bao giờ có UI salon — đây là "não" đáng tiền nhất |
| Deposit | CƠ BẢN | Tiệm cần tự đặt mức cọc |

## 3. Chuyên sâu — mặc định ẨN (`platform`), bật khi bán add-on

| Mục | Trạng thái feature-policy | Đề xuất |
|---|---|---|
| Email marketing (bulk) | đã `platform` ✓ | Giữ |
| AI Hotline (voice) | đang `salon` | → `platform` (add-on trả phí) |
| Messenger bot | đang `salon` | Giữ `salon` (điểm bán hàng chính) — nhưng rút gọn UI: chỉ Greeting + Facts + ghi chú; phần prompt đã ở server ✓ |
| Reviews & rewards (anti-fraud) | đang `salon` | → `platform` — luật chống gian lận là ý tưởng dễ bị copy nhất |
| Marketing & campaigns (UTM, offers) | đang `salon` | → `platform` |
| Integrations & API keys | đang `salon` | → `platform` (chỉ tiệm nào thật sự cần) |
| Payroll (công thức hoa hồng) | chưa có key | Thêm key, mặc định `platform` |
| Chain / multi-location | chưa có key | Thêm key, `platform` (bán theo gói) |
| Stations / Tables / Menu (ngành khác) | chưa có key | Thêm key, `platform` — tiệm nail không cần thấy, đỡ lộ tham vọng đa ngành |
| Payment terminals | chưa có key | Thêm key, `platform` |

## 4. GIẤU HẲN — không có UI salon, chỉ Super Admin / server

| Mục | Hiện ở đâu | Việc cần làm |
|---|---|---|
| Trọng số auto-assignment (rotation, skill, lịch sử) | server code ✓ | Không thêm UI salon về sau |
| Prompt AI Messenger/Voice | server code ✓ | Giữ nguyên |
| Ngưỡng anti-fraud reviews, velocity/spam limits | server code ✓ | Giữ nguyên |
| Retention windows (180/90/30 ngày), grace bin 7 ngày | env + hằng số ✓ | Giữ nguyên |
| Feature-policy per tiệm | Super Admin ✓ | Giữ nguyên |
| Ngưỡng chống lạm dụng loyalty/referral | server | Nếu sau này cần chỉnh per-tiệm → làm ở Super Admin portal, không đưa xuống salon |

## Thứ tự thực thi đề xuất

1. Thêm ~6 key mới vào `FEATURE_DEFS` + đổi default 4 key hiện có → phần Chuyên sâu ẩn ngay (nửa ngày, nền có sẵn).
2. Rút gọn UI Messenger + Loyalty (bỏ ô nâng cao khỏi salon).
3. Setup wizard 5 bước cho tiệm mới (bước sau, khi bạn chốt danh sách Cơ bản).

**Cần bạn quyết:** (a) Voice AI + Reviews + Marketing có đúng là add-on trả phí không, hay tiệm nào cũng được dùng? (b) Messenger bot để mọi tiệm thấy (điểm bán hàng) hay cũng ẩn?
