# Kịch bản test hệ thống booking A→Z (Messenger → hoàn tất lịch hẹn)

Tiệm test: **Lumio Salon** · page **Lumio Booking** · mở **9:00 – 18:00 cả 7 ngày**
Thợ: **Le · Lisa · Hana** · 66 dịch vụ
Đang giảm giá: **Pedicure nail $25 (−20%) · Nail Design $25 (−10%) · Colour add-on $30 (−10%)**

Cách dùng: copy từng dòng trong khung, gửi vào Messenger của page, đối chiếu cột "Bot phải trả lời". Gửi **từng tin một**, đợi bot trả lời rồi mới gửi tin kế.

---

## PHẦN 0 — Chuẩn bị (3 phút, làm một lần)

- [ ] Deploy `lumio-api` + `lumio-web` bản mới nhất.
- [ ] Business Suite → page Lumio Booking → Inbox → **Automations: tắt hết** (Instant reply, Away message, FAQ). Không tắt thì Meta trả lời trước và bot sẽ im.
- [ ] Dùng **một tài khoản Facebook cá nhân khác** (không phải tài khoản admin page) để đóng vai khách. Nhắn bằng chính tài khoản admin thì tin của bạn bị coi là tin nhân viên.
- [ ] Mở sẵn dashboard tiệm ở tab khác: `lumiobooking.com/salon/messenger` và `lumiobooking.com/salon/calendar`.
- [ ] Nếu đã test trước đó: vào Messenger bot → mục Conversations → hội thoại của bạn → bấm **trả lại quyền cho bot** (nếu đang ở chế độ người thật).

---

## PHẦN 1 — Luồng chính: đặt lịch thành công

| # | Copy gửi vào Messenger | Bot phải trả lời |
|---|---|---|
| 1 | *(mở cửa sổ chat, chưa gõ gì)* | Màn hình hiện lời chào: "Hi! 👋 Welcome to Lumio Salon — manicures, pedicures, facials and massage, with 10% off colour add-ons this month." + ô gõ tin **không có nút Get Started** |
| 2 | `Hi` | Chào lại ngắn, hỏi muốn làm dịch vụ gì. 1–2 câu, không dài dòng |
| 3 | `What services do you have?` | Liệt kê vài dịch vụ tiêu biểu **có giá thật** (Luxury Manicure $45, Bio Gel New Set $55, Mini Facial $65…), không bịa dịch vụ lạ |
| 4 | `How much is a luxury manicure and how long?` | **$45, 45 phút** — đúng số trong hệ thống |
| 5 | `Any promotions right now?` | Nêu đúng dịch vụ đang giảm: **Pedicure nail giảm 20%**, Nail Design/Colour giảm 10%. Không được bịa khuyến mãi khác |
| 6 | `What time do you open tomorrow?` | **9:00 AM – 6:00 PM** |
| 7 | `I'd like to book a luxury manicure tomorrow at 2pm` | Xác nhận dịch vụ + giờ, rồi hỏi **tên** (chỉ hỏi MỘT thứ) |
| 8 | `Anna Nguyen` | Cảm ơn, hỏi **số điện thoại** |
| 9 | `5125551234` | Xác nhận đã đặt xong: dịch vụ, ngày giờ, và báo sẽ có xác nhận gửi tới |
| 10 | `Thank you` | Câu cảm ơn/kết thúc lịch sự, không hỏi thêm |

**Đạt yêu cầu khi**: bot chỉ hỏi mỗi tin một thứ, không hỏi lại thứ đã biết, giá và giờ khớp hệ thống, và bước 9 xác nhận đặt thành công.

---

## PHẦN 2 — Kiểm tra kết quả trong hệ thống (bắt buộc)

Sau bước 9, mở dashboard tiệm:

| Nơi kiểm tra | Phải thấy |
|---|---|
| **Calendar** → ngày mai 2:00 PM | Lịch hẹn **Anna Nguyen — Luxury Manicure**, dài 45 phút, đã gán thợ |
| **Bookings** | Dòng lịch hẹn mới, nguồn ghi nhận từ Messenger |
| **Customers** | Khách mới **Anna Nguyen** với SĐT 5125551234 |
| **Messenger bot → Conversations** | Toàn bộ hội thoại vừa rồi, đúng thứ tự |
| Điện thoại/email khách *(nếu đã bật SMS/email)* | Tin xác nhận lịch hẹn |

---

## PHẦN 3 — Các tình huống phải test thêm

### 3.1 Ngoài giờ mở cửa — bot không được nhận bừa

```
Can I come at 11pm tonight?
```
→ Phải nói tiệm đóng cửa lúc đó (mở tới 6:00 PM) và **đề nghị giờ gần nhất còn mở**. Sai nếu bot nhận lịch 11 giờ đêm.

### 3.2 Chọn thợ quen

```
Can I request Lisa next time?
```
→ Xác nhận được yêu cầu thợ quen (Lisa là thợ có thật trong hệ thống).

### 3.3 Hỏi thứ hệ thống không có — không được bịa

```
Do you do eyelash extensions?
```
→ Nếu tiệm không có dịch vụ này: nói không chắc / sẽ nhờ tiệm xác nhận. **Sai nếu bot tự nhận làm được.**

### 3.4 Nhân viên tiếp quản — bot phải im ngay

1. Từ tài khoản khách, gửi: `Can I change my appointment?`
2. Bot trả lời.
3. **Bạn vào Business Suite (hoặc dashboard) trả lời tay** một câu bất kỳ.
4. Từ tài khoản khách gửi tiếp: `Ok thanks`

→ Bot **không được trả lời** trong 5 phút đầu. Nếu bạn im luôn thì sau đúng 5 phút bot mới đỡ lời. Bạn im quá 15 phút thì bot lấy lại quyền ngay khi khách nhắn.

### 3.5 Khách cũ quay lại — bot phải nhớ (test sau ≥1 ngày)

Hôm sau, từ chính tài khoản khách đó gửi:

```
Hi, is my appointment still on?
```

→ Bot **không được chào lại như người lạ**, không hỏi lại tên/dịch vụ đã biết, phải trả lời thẳng dựa trên hội thoại cũ.

### 3.6 Hỏi thông tin ngoài lịch hẹn

```
Where do I park?
```
→ "Free parking lot in front of the salon." (lấy từ bảng thông tin đã điền)

```
Do you take Apple Pay?
```
→ "Card, cash, Apple Pay and gift cards."

---

## PHẦN 4 — Bản tiếng Anh liền mạch cho video App Review

Copy lần lượt, quay màn hình không cắt:

```
Hi
```
```
Do you do gel manicures and how much?
```
```
Any promotions this week?
```
```
I'd like to book a luxury manicure tomorrow at 2pm
```
```
Anna Nguyen
```
```
5125551234
```
```
Thank you
```

Sau tin cuối, chuyển sang tab dashboard quay tiếp: **Calendar** (thấy lịch hẹn vừa tạo) → **Messenger bot → Conversations** (thấy hội thoại). Đây là đoạn chứng minh "tính năng rõ ràng" mà lần trước Meta chê thiếu.

---

## PHẦN 5 — Bảng xử lý khi test không đạt

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Bot không trả lời gì | Automations của Business Suite đang bật, hoặc hội thoại đang ở chế độ người thật | Tắt Automations; vào Conversations trả quyền lại cho bot |
| Bot trả lời rồi im hẳn | Bạn vừa nhắn tay bằng tài khoản admin → hệ hiểu là nhân viên vào cuộc | Dùng tài khoản Facebook khác đóng vai khách |
| Trả lời chậm hơn 10 giây | API vừa khởi động lại sau deploy | Nhắn lại sau 1 phút |
| Giá sai so với menu | Dịch vụ sửa giá nhưng chưa lưu, hoặc dịch vụ đang tắt | Kiểm tra trang Services |
| Không nêu khuyến mãi | Dịch vụ chưa đặt % giảm giá | Services → sửa dịch vụ → điền % giảm |
| Đặt lịch xong nhưng Calendar trống | Giờ hẹn rơi ngoài giờ mở cửa hoặc trùng lịch thợ | Thử giờ khác trong 9:00–18:00 |
| Vẫn hiện nút Get Started | Messenger cache màn hình chào | Đóng hẳn app Messenger, mở lại; hoặc test bằng tài khoản khác |
| Bot chào lại như người lạ dù đã chat trước | Bản API chưa có tính năng nhớ khách | Deploy `lumio-api` bản mới nhất |

---

## PHẦN 6 — Dọn dẹp sau khi test

- Xóa lịch hẹn test **Anna Nguyen** trong Calendar (nếu không muốn lẫn số liệu).
- Xóa khách test trong Customers.
- Nếu có bật lại Automations trong lúc test thì tắt lại trước khi quay video App Review.
