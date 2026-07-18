# Reserve with Google — Nội dung nộp đơn (Partner interest form) + Bản tự đánh giá kỹ thuật

> Cách dùng: mở **Partner interest form** của Reserve with Google (Actions Center → Reservations End-to-End), copy nội dung dưới vào từng ô. Chỗ **[trong ngoặc]** anh điền số/tên thật.

---

## A. Thông tin đối tác (Partner / Platform)
- **Company / platform name:** Lumio Booking (by Lumio Agency)
- **Legal entity name:** [tên pháp nhân đăng ký]
- **Website:** https://lumiobooking.com
- **HQ / country:** [VD: United States] — phục vụ thị trường **US & Canada**
- **Primary contact:** [tên] — [email] — [điện thoại]
- **Technical contact:** [tên/email dev]
- **Vertical / use case:** Reservations **End-to-End** (Health & Beauty — **nail salons / spas**)
- **Are you a booking software provider with your own merchants?** Yes.

## B. Quan hệ với merchant (Google bắt buộc)
- Chúng tôi có **quan hệ hợp đồng trực tiếp** với từng tiệm: mỗi salon **mua/đăng ký** phần mềm Lumio (multi-tenant SaaS), có tài khoản riêng, tự quản lý dịch vụ/nhân viên/lịch.
- Danh sách merchant sẽ **khớp địa điểm Google Maps** theo tên + địa chỉ + số điện thoại của từng tiệm (trùng với Google Business Profile họ sở hữu/đã xác minh).
- Số merchant hiện tại: **[số tiệm đang dùng]**; dự kiến 12 tháng: **[con số]**.

## C. Năng lực kỹ thuật (đối chiếu yêu cầu Google)
| Yêu cầu của Google | Lumio đáp ứng |
|---|---|
| Availability **thời gian thực**, trả lời **< 1 giây** | ✅ Có API lịch trống realtime theo từng dịch vụ/thợ; phản hồi nhanh. |
| **≥ 30 ngày** lịch trống phía trước | ✅ Cấu hình `maxAdvanceDays` mặc định ≥ 30 (điều chỉnh được). |
| Hỗ trợ **huỷ đặt online** | ✅ Có link tự quản lý (confirm/cancel) không cần đăng nhập. |
| **Booking server** HTTPS + TLS hợp lệ | ✅ API chạy HTTPS (Render), chứng chỉ hợp lệ. |
| **HTTP basic auth**, đổi mật khẩu mỗi 6 tháng | ✅ Sẽ cấu hình endpoint riêng cho Google với basic auth + xoay khoá định kỳ. |
| Feed **merchants / services / availability** | ✅ Dữ liệu multi-tenant sẵn có; sẽ sinh feed đúng schema Actions Center. |
| Đặt/huỷ/cập nhật booking qua API | ✅ Có luồng tạo booking (PENDING→confirm), auto-assign thợ, huỷ. |

**Booking flow hiện có:** khách chọn dịch vụ (nhiều dịch vụ/lượt) → thợ (hoặc "Any", hệ thống tự phân bổ) → ngày/giờ theo lịch trống thực tế → xác nhận → SMS/email xác nhận. Hỗ trợ đặt cọc, thanh toán online/tại tiệm.

## D. Quy mô & vận hành
- Nền tảng multi-tenant, **tách biệt dữ liệu từng tiệm** (mỗi tiệm 1 booking URL `lumiobooking.com/<slug>`).
- Có sẵn: nhắc lịch tự động, chống spam/rate-limit, audit log, đo lường per-tiệm (GA4/GTM).
- Đội ngũ hỗ trợ: [mô tả ngắn].

---

## E. Sau khi Google nhận đơn — việc Lumio (em) sẽ code
Khi anh được cấp **Actions Center Partner Portal**, em dựng:
1. **Feeds:** `merchants` (map với Maps), `services`, `availability` (định kỳ + realtime).
2. **Booking server** đúng chuẩn: `HealthCheck`, `CheckAvailability`, `CreateBooking`, `UpdateBooking`, `GetBookingStatus`, `ListBookings` (huỷ/đổi).
3. **Auth** basic + endpoint riêng cho Google; logging; đáp ứng < 1s.
4. **Sandbox test** với Google → sửa theo review → **go live** → nút tự gắn cho các tiệm đã match.

## F. Việc CHỈ anh làm được (Google yêu cầu chính chủ)
1. **Nộp Partner interest form** (hoặc liên hệ Google contact) bằng nội dung trên.
2. **Ký các thoả thuận** đối tác với Google.
3. Trong **Partner Portal**: xác nhận sở hữu/khai brand + upload danh sách merchant.
4. Đảm bảo mỗi tiệm đã **verified** Google Business Profile và **khớp thông tin** với feed.
5. Phối hợp email review của Google trong quá trình chứng nhận.

> Em không thể thay anh nộp đơn/ký với Google hay đăng nhập tài khoản Google của tiệm — nhưng toàn bộ phần code + feed + booking server em làm trọn gói khi anh được nhận vào chương trình.
