# Reserve with Google — BỘ HỒ SƠ NỘP (sẵn sàng gửi)

> **Nộp ở đâu:** mở trang **Actions Center → Reservations End-to-End → Overview**
> (`https://developers.google.com/actions-center/verticals/reservations/e2e/overview`) →
> bấm **"complete this interest form"** (Partner interest form). Copy nội dung dưới vào form.
> Chỗ **[trong ngoặc]** = anh điền; phần còn lại đã soạn sẵn.

---

## PHẦN 1 — Điền vào Partner interest form

**Company / platform name:** Lumio Booking (Lumio Agency)
**Legal entity name:** [tên pháp nhân đã đăng ký — VD LLC/Inc]
**Website:** https://lumiobooking.com
**Country / markets:** [VD United States] — phục vụ **US & Canada**
**Business/BD contact:** [Họ tên] · [email] · [số điện thoại]
**Technical contact:** [Họ tên dev] · [email]
**Vertical:** Reservations **End-to-End** — Health & Beauty (**nail salons / spas**)
**You are:** A booking software provider (multi-tenant SaaS) with our **own merchants**.
**Number of merchants (live):** [số tiệm đang dùng Lumio]
**Expected merchants in 12 months:** [ước tính]
**Do you have a direct contractual relationship with merchants?** **Yes** — each salon subscribes to Lumio and manages its own account.
**Can your merchants be matched to Google Maps listings?** **Yes** — by name + address + phone (and Place ID where available).
**Booking volume / month (approx):** [ước tính lượt đặt/tháng]

**Short description (paste):**
> Lumio Booking is a multi-tenant online-booking platform for nail salons and spas in the US and Canada. Each salon has its own account, services, staff, real-time availability and a hosted booking page (lumiobooking.com/<salon>). We want to integrate Reservations End-to-End so customers can book these salons directly from Google Search and Maps. We have direct contracts with each merchant and can provide real-time availability, 30+ days of slots, and online cancellation.

---

## PHẦN 2 — Bản tự đánh giá kỹ thuật (đối chiếu yêu cầu Google)

| Yêu cầu Google | Trạng thái Lumio |
|---|---|
| Availability **thời-gian-thực**, trả < 1 giây | ✅ Có API lịch trống theo dịch vụ/thợ, phản hồi nhanh |
| **≥ 30 ngày** lịch trống | ✅ Cấu hình `maxAdvanceDays` — sẽ đảm bảo ≥ 30 cho các tiệm bật RwG |
| **Huỷ đặt online** | ✅ Link tự quản lý (confirm/cancel), không cần đăng nhập |
| Booking server **HTTPS + TLS** | ✅ API chạy HTTPS, chứng chỉ hợp lệ |
| **HTTP basic auth**, xoay khoá mỗi 6 tháng | ✅ Sẽ mở endpoint riêng cho Google + basic auth + xoay khoá |
| Feed **merchants / services / availability** | ✅ Dữ liệu multi-tenant sẵn có; sẽ sinh feed đúng schema |
| Tạo / cập nhật / huỷ booking qua API | ✅ Có luồng tạo booking + auto-assign thợ + huỷ |

---

## PHẦN 3 — Việc CHỈ anh làm được (Google bắt buộc chính chủ)
1. **Nộp Partner interest form** (nội dung Phần 1).
2. Khi Google mời → tạo tài khoản **Actions Center**, **ký thoả thuận** đối tác.
3. Trong **Partner Portal**: khai **brand** + **upload danh sách tiệm** (dùng file `Lumio-RwG-MerchantList-Template.csv`) để Google match với Maps.
4. Đảm bảo mỗi tiệm đã **verified** Google Business Profile, thông tin **trùng** với feed.
5. Phối hợp các email review/chứng nhận của Google.

## PHẦN 4 — Việc em (Lumio) làm sau khi được nhận
1. Sinh **feeds** (merchants/services/availability) đúng schema Actions Center.
2. Dựng **booking server**: `HealthCheck`, `CheckAvailability`, `CreateBooking`, `UpdateBooking`, `GetBookingStatus`, huỷ/đổi — basic auth, < 1s.
3. **Test sandbox** với Google → sửa theo review → **go live**.
4. Nút xanh "Book online" **tự gắn** cho các tiệm đã match; tiệm mới trong Lumio tự vào feed.

## Checklist trước khi bấm nộp
- [ ] Điền hết ô `[trong ngoặc]` ở Phần 1
- [ ] Chuẩn bị `Lumio-RwG-MerchantList-Template.csv` (ít nhất vài tiệm thật, verified)
- [ ] Có email liên hệ nhận thư mời từ Google
- [ ] Xác nhận các tiệm khớp tên/địa chỉ/điện thoại với Google Maps
