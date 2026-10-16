# Hồ sơ nộp Google Actions Center — Appointments Redirect (bản 16/10/2026)

Thay thế bản 30/07 (`Lumio-RwG-Ho-So-Dang-Ky.md`) ở phần loại tích hợp: Lumio nộp **Appointments → Redirect**, không phải "Reservations Business Link". Feed, trang đặt lịch và theo dõi chuyển đổi đã được xây sẵn trong hệ thống (xem Phần 4).

---

## PHẦN 1 — NỘI DUNG DÁN VÀO FORM ĐĂNG KÝ

Form: https://services.google.com/fb/forms/reservationsappointmentsonlinebooking-interestform/ (Google có thể đổi trường; gặp trường nào dán nội dung tương ứng.)

| Trường | Nội dung |
|---|---|
| Company / Partner name | `Lumio Agency` |
| Platform / Product name | `Lumio Booking` |
| Website | `https://lumiobooking.com` |
| Country of incorporation | *(quốc gia pháp nhân — điền thật)* |
| Contact name / email | *(người phụ trách)* — dùng email tên miền (vd `partners@lumiobooking.com`), không dùng Gmail |
| Business type | `Appointment-booking software (SaaS) operating the online booking channel for independent beauty merchants` |
| Vertical | `Appointments — Beauty & personal care (nail salons, spas)` |
| Integration type | `Appointments Redirect` |
| Countries | `United States, Canada, Australia` *(thêm Vietnam nếu Google xác nhận hỗ trợ)* |
| Number of merchants live | *(số tiệm ACTIVE thật — lấy từ /agency)* |
| Expected in 12 months | *(ước lượng thật)* |
| Monthly bookings | *(số thật từ dashboard)* |

**Mô tả nền tảng (dán nguyên khối):**

> Lumio Booking is a multi-tenant online booking platform for nail salons and spas in the United States, Canada and Australia. Every merchant has a permanent, merchant-specific booking page (for example https://lumiobooking.com/lux-nail-spa/gbp) listing its bookable services with duration and price. A customer picks a service, a technician and a time slot, and receives an immediate confirmation by email and SMS; no account creation or payment is required to complete a booking. We operate the booking engine, calendar, staff scheduling, point of sale and customer records for each merchant under a direct service agreement with that merchant.

**Loại tích hợp mong muốn:**

> We would like to integrate through Appointments Redirect: we provide the Entity, Services and Action feeds daily over SFTP, with a place-level action link and a service-level action link (service pre-selected) for every merchant. We have already implemented conversion tracking v2 (rwg_token capture and the conversion collect endpoint). We may consider the End-to-End integration later.

**Năng lực kỹ thuật:**

> We have an in-house engineering team and full control of our stack (NestJS API, PostgreSQL, Next.js front end, hosted on Render). Feed generation, data-quality validation against the Actions Center content policies, and the daily SFTP upload are automated in our platform. Landing pages are HTTPS, mobile-first and server-rendered for crawlers, show the merchant's name, address and bookable services above the fold, and never require sign-in or payment at the first step. Merchants that fail our policy checks are automatically held out of the feed until fixed.

**Quan hệ với merchant & hỗ trợ:**

> Every merchant in our feed has a signed subscription agreement with Lumio. We provide first-line support to customers for booking issues and will respond to escalated issues within one business day for emergencies and two business days otherwise. Bookings originating from Google are attributed to Google in each merchant's dashboard.

---

## PHẦN 2 — VIỆC LUMIO PHẢI LÀM TRƯỚC KHI NỘP (không phải code)

- [ ] Chạy `deploy.bat` (đã chứa toàn bộ phần kỹ thuật).
- [ ] Vào **/agency → 📍 Nút Google**: ít nhất 5–10 tiệm ở trạng thái **Sẵn sàng** (sửa tên viết HOA, dịch vụ có giá/thời lượng, nối đúng Google). Chụp màn hình bảng này.
- [ ] Mỗi tiệm trong feed: tên trên Lumio **khớp tên pháp lý trên Google Maps**, hồ sơ Google đã xác minh, địa chỉ đúng.
- [ ] Email tên miền cho hồ sơ đối tác và hộp thư hỗ trợ (SLA: khẩn 1 ngày làm việc, thường 2 ngày).
- [ ] Trang **Terms** và **Privacy** công khai trên lumiobooking.com (đã có `/terms`, `/privacy`, `/merchant-terms` — kiểm tra nội dung còn đúng).
- [ ] Hợp đồng/điều khoản thuê bao với từng tiệm lưu file (Google có thể hỏi "direct agreement").
- [ ] Tải **6 file feed hôm nay** từ màn hình agency để đính kèm/giới thiệu nếu Google hỏi mẫu.
- [ ] Số liệu thật: số tiệm, số booking/tháng (không thổi phồng).

## PHẦN 3 — SAU KHI GOOGLE MỜI VÀO PARTNER PORTAL

1. Configuration → **SSH key**: tạo cặp key, dán public key; private key (PEM) → env `RWG_SFTP_KEY`; host/user/port SFTP → `RWG_SFTP_HOST`, `RWG_SFTP_USER`, `RWG_SFTP_PORT` (mặc định 19321), thư mục `RWG_SFTP_DIR` nếu Google chỉ định.
2. **Brand**: "Lumio Booking" + logo; **Contacts**: kỹ thuật + hỗ trợ; chấp nhận Google APIs ToS.
3. **Conversion partner id** → env `NEXT_PUBLIC_RWG_PARTNER_ID`; khi test đặt `NEXT_PUBLIC_RWG_SANDBOX=1`, lên production thì bỏ.
4. Bật `RWG_FEED_AUTORUN=true` (feed chạy ~03:00 UTC hằng ngày) hoặc bấm **Tạo & upload ngay** trên màn hình agency.
5. Feeds › History: 0 lỗi; Onboarding Health; Google review bấm thử link → Production → Launch.

## PHẦN 4 — NHỮNG GÌ HỆ THỐNG ĐÃ CÓ (để trả lời câu hỏi kỹ thuật của Google)

| Yêu cầu Google | Lumio |
|---|---|
| Entity feed (`reservewithgoogle.entity`) | `google-book/feed.ts` — tên, SĐT E.164, website, toạ độ + địa chỉ có cấu trúc đọc từ Business Profile API, bookability, chính sách huỷ |
| Services feed (`glam.service.v0`) | giá `price_micros`, thời lượng giây, nhóm, mô tả, action link chọn sẵn dịch vụ |
| Action feed (`reservewithgoogle.action.v2`) | link cấp tiệm `https://lumiobooking.com/<slug>/gbp` |
| Descriptor + upload SFTP hằng ngày | `google-book.service.ts` + scheduler |
| Chất lượng dữ liệu | `feed-lint.ts` chặn tiệm/dịch vụ vi phạm (HOA toàn bộ, emoji, giá/SĐT/URL trong tên…) |
| Landing page | SSR menu cho crawler (`<noscript>`), `?service=` chọn sẵn, không login/payment wall |
| Conversion tracking v2 | cookie `_rwgToken` 30 ngày + POST `maps/conversion/collect` khi đặt xong |
| Attribution trong dashboard tiệm | nguồn Google Maps, `utm_content=rwg_button` |
| Cách ly dữ liệu | mọi query theo tenantId; tiệm khoá/tắt/nối sai không vào feed (có test) |

## PHẦN 5 — CÂU TRẢ LỜI THẲNG VỀ "LINK DÁN TAY"

- Google **có** hiện nút "Book online" cho link đặt lịch do chủ hồ sơ tự dán (mục Bookings/Appointment links) — không bắt buộc phải là đối tác. Nhưng Google quét link mỗi ngày, âm thầm gỡ khi không đạt, không có bước duyệt rõ ràng và không cam kết hiển thị. Đây là lý do mấy tháng qua dán mà không thấy.
- Sau deploy, dán lại link `/gbp` (trang giờ có HTML cho crawler) và kiểm tra sau 48 giờ; đồng thời nộp hồ sơ đối tác. Nút của đối tác là link do Google tự thêm cho mọi tiệm, có tên Lumio, không bị gỡ kiểu này.
