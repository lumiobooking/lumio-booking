# Đưa nút "Book online" của Lumio lên Google Business Profile — Playbook A→Z

## 0. Sự thật cần biết trước
Nút **"Book online"** nổi bật trên hồ sơ Google **không tự bật được**. Nó đến từ 1 trong 2 nguồn, và cả hai đều cần **quyền trên tài khoản Google của tiệm** + **Google duyệt** — không bên thứ ba nào (kể cả Lumio) tự làm thay được 100%.

| | ① Link tự thêm (nhanh) | ② Reserve with Google (mạnh) |
|---|---|---|
| Ai làm | Chủ tiệm / agency | Lumio (code) + anh (nộp đơn Google) |
| Thời gian | 24–48h | vài tuần–tháng |
| Chi phí | Miễn phí | Miễn phí (công sức lớn) |
| Phạm vi | Từng tiệm 1 | Tự gắn cho MỌI tiệm Lumio |
| Kết quả | Nút/đường dẫn "Book online" | Nút tích hợp đầy đủ (như ảnh) |

**Khuyên:** chạy ① ngay cho từng tiệm demo/khách để có nút trong vài ngày; đồng thời nộp đơn ② để dài hạn mọi tiệm Lumio tự có nút (lợi thế bán hàng lớn).

---

## ① ĐƯỜNG NHANH — thêm link đặt lịch vào Google (mỗi tiệm ~5 phút)

**Điều kiện:** hồ sơ Google Business của tiệm đã **được xác minh (verified)**; ngành nghề là **Nail salon** (thuộc nhóm đủ điều kiện đặt lịch).

**Lấy link Lumio:** trong Lumio (tài khoản tiệm) → **Integrations → Booking link** → copy `https://lumiobooking.com/<slug>` (VD `https://lumiobooking.com/fusion-nail-spa`).

**Các bước trên Google:**
1. Đăng nhập **business.google.com** bằng Google account **sở hữu/được quản lý** hồ sơ tiệm (hoặc mở Google Maps → tìm tiệm → **Edit profile**).
2. Vào **Edit profile → Bookings** (một số hồ sơ ghi **"Appointment links"** hoặc **"Online booking"**).
3. Bấm **Add appointment link / ✎** → **dán link Lumio** của tiệm (link đặt lịch trực tiếp, KHÔNG phải trang chủ website).
4. **Save**. Google duyệt link ~**24–48h** → nút **"Book online"** xuất hiện trên Maps + Search.

**Lưu ý quan trọng:**
- Nếu tiệm **đang dùng provider khác** (Booksy/Vagaro/Fresha…) đã tự gắn Reserve-with-Google, Google **ưu tiên cái đó** → phải **gỡ liên kết provider cũ** thì link Lumio mới hiện.
- Google có thể tự **phát hiện provider** và ghi đè; nếu bị ghi đè, dùng phần **"Bạn quản lý link này"** để đặt lại link Lumio.
- Có thể thêm **nhiều link** (đặt lịch + menu…) nhưng nên để **1 link đặt lịch chính** = Lumio.

---

## ② ĐƯỜNG MẠNH — Reserve with Google (Actions Center)

Đây là thứ tạo **nút tích hợp thật sự**, và một khi được duyệt, **tự gắn cho mọi tiệm Lumio khớp địa điểm** — không phải làm thủ công từng tiệm.

### Yêu cầu của Google (Reservations End-to-End)
- **Quan hệ hợp đồng trực tiếp** với các tiệm (✅ anh có — họ mua phần mềm).
- Danh sách tiệm **khớp địa điểm Google Maps** (tên/địa chỉ/điện thoại trùng).
- **API còn-slot thời gian thực**: Google gọi hỏi, Lumio trả **< 1 giây**.
- Có **≥ 30 ngày** lịch trống ở phía trước.
- Hỗ trợ **huỷ đặt online**.
- **Booking server**: TLS/HTTPS hợp lệ + **HTTP basic auth** (đổi mật khẩu mỗi 6 tháng).
- Qua **sandbox/chứng nhận** của Google trước khi go-live.

### Các bước triển khai (thứ tự)
1. **Nộp Partner interest form** của Reserve with Google (hoặc làm việc qua Google contact) → xác nhận năng lực kỹ thuật.
2. Được cấp quyền **Actions Center → Partner Portal** → khai **brand** + tải lên **danh sách merchant** (các tiệm Lumio) để Google **match** với Maps.
3. **Lumio dựng (phần em code):**
   - **Feeds**: `merchants`, `services`, `availability` (đẩy định kỳ + realtime).
   - **Booking server** đúng chuẩn Google: `CheckAvailability`, `CreateBooking`, `UpdateBooking` / `CancelBooking`, `GetBookingStatus`.
   - Auth (HTTP basic), health-check, đáp ứng < 1s.
4. **Test sandbox** với Google → sửa theo feedback → **Google review** → **go live**.
5. Nút **tự gắn** cho các tiệm đã match. Tiệm mới thêm vào Lumio → tự vào feed → tự có nút.

### Ai làm gì
- **Anh (bắt buộc, Google yêu cầu):** nộp Partner interest form, ký thoả thuận, khai Partner Portal, xác nhận sở hữu/quan hệ với merchant. *(Em không thay anh nộp/ký với Google được.)*
- **Lumio (em):** toàn bộ feed + booking server + tích hợp; test sandbox.

---

## Gợi ý lộ trình
- **Tuần này:** chạy ① cho shop demo (Fusion/Lumio Salon) + 2–3 khách đầu → có nút "Book online" làm bằng chứng bán hàng.
- **Song song:** anh nộp **Partner interest form** Reserve with Google. Khi Google nhận, báo em — em dựng integration ②, từ đó **mọi tiệm Lumio tự có nút** mà không cần thao tác từng cái.

> Khi bán cho khách: "Đặt lịch ngay từ Google, không cần tải app" là một chốt sale rất mạnh — ① cho hiệu quả tức thì, ② là vũ khí dài hạn của cả nền tảng.
