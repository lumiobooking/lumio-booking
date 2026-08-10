# Kịch bản chat để quay video — gõ đúng từng câu

Tiệm: **Lumio Salon** · Giờ mở cửa **9:00 AM – 6:00 PM** cả 7 ngày
Dịch vụ dùng trong kịch bản: **Luxury Manicure — $45 — 45 phút**
Thợ trong hệ thống: Le · Lisa · Hana

> Bot là AI nên **câu chữ mỗi lần một khác**. Cột "Bot phải có" là những thông tin **bắt buộc** phải xuất hiện — đúng những cái đó là đạt, không cần giống từng chữ.

> **Gõ từng tin một, đợi bot trả lời rồi mới gõ tin kế.** Gõ dồn nhiều tin liên tiếp sẽ làm bot gộp câu trả lời, video nhìn rối.

---

# PHẦN 1 — MESSENGER (quay trước)

| # | Bạn gõ | Bot phải có trong câu trả lời |
|---|---|---|
| 1 | `Hi` | Lời chào, hỏi muốn làm dịch vụ gì |
| 2 | `Do you do gel manicures and how much?` | Nêu dịch vụ gel có thật + **giá** (vd Bio Gel New Set $55, UV Gel New Set $62) |
| 3 | `What time do you open tomorrow?` | **9:00 AM – 6:00 PM** |
| 4 | `I'd like to book a Luxury Manicure tomorrow at 2pm` | Xác nhận dịch vụ + giờ, rồi **hỏi tên** |
| 5 | `Anna Nguyen` | Cảm ơn, **hỏi số điện thoại** |
| 6 | `5125551234` | **Xác nhận đã đặt xong**: Luxury Manicure, ngày mai 2:00 PM |
| 7 | `Thank you` | Câu cảm ơn / kết thúc lịch sự |

**Chuỗi copy nhanh** (gõ lần lượt, mỗi dòng một tin):

```
Hi
```
```
Do you do gel manicures and how much?
```
```
What time do you open tomorrow?
```
```
I'd like to book a Luxury Manicure tomorrow at 2pm
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

---

# PHẦN 2 — INSTAGRAM (quay sau, từ điện thoại `nguyenviet14546` → `@lumio_bk`)

Cũng đi **trọn tới lúc đặt lịch xong** như Messenger — dùng **dịch vụ khác và giờ khác** để hai lịch hẹn hiện riêng biệt trong Calendar.

| # | Bạn gõ | Bot phải có trong câu trả lời |
|---|---|---|
| 1 | `META-REVIEW-IG-001` | Lời chào, hỏi giúp gì được |
| 2 | `Do you do gel manicures and how much?` | Dịch vụ gel có thật + **giá** (Bio Gel New Set $55 / UV Gel New Set $62) |
| 3 | `I'd like to book a Bio Gel New Set tomorrow at 3pm` | Xác nhận dịch vụ + giờ, rồi **hỏi tên** |
| 4 | `Kim Tran` | Cảm ơn, **hỏi số điện thoại** |
| 5 | `5125559876` | **Xác nhận đặt xong**: Bio Gel New Set, ngày mai 3:00 PM |
| 6 | `Thank you` | Câu cảm ơn / kết thúc |

**Chuỗi copy nhanh:**

```
META-REVIEW-IG-001
```
```
Do you do gel manicures and how much?
```
```
I'd like to book a Bio Gel New Set tomorrow at 3pm
```
```
Kim Tran
```
```
5125559876
```
```
Thank you
```

> Vì sao khác Messenger: Messenger đặt **Luxury Manicure 2:00 PM cho Anna Nguyen**, Instagram đặt **Bio Gel New Set 3:00 PM cho Kim Tran**. Hai lịch không trùng giờ, và trong Calendar reviewer thấy rõ **hai lịch hẹn đến từ hai kênh khác nhau** — bằng chứng mạnh nhất cho `instagram_manage_messages`.

---

# PHẦN 3 — CÂU GỬI TAY (cảnh Take over)

Sau khi bấm **Take over**, gõ vào khung **Send a test message**:

```
Hi Anna, this is Mia from the salon team — I'm taking over this chat to help you directly.
```

Gửi xong, chuyển sang màn hình điện thoại cho thấy tin vừa tới, rồi bấm **Give back to bot**.

---

# PHẦN 4 — XỬ LÝ KHI BOT HỎI KHÁC KỊCH BẢN

Bot có thể hỏi lệch một chút. Trả lời tự nhiên theo bảng này, **đừng dừng quay**:

| Bot hỏi | Bạn gõ |
|---|---|
| Hỏi tên và số cùng lúc | `Anna Nguyen, 5125551234` |
| Hỏi email | `skip` hoặc `no email, thanks` |
| Hỏi muốn thợ nào | `Anyone is fine` |
| Hỏi lại giờ / báo giờ đó bận | `How about 3pm tomorrow?` |
| Hỏi xác nhận lần cuối | `Yes, please confirm` |
| Đề nghị dịch vụ khác | `Luxury Manicure is fine` |

---

# PHẦN 5 — KIỂM TRA SAU KHI CHAT XONG

Trước khi tắt máy quay, quay tiếp các màn hình này:

- [ ] **Calendar** → ngày mai có **HAI** lịch: **2:00 PM Anna Nguyen — Luxury Manicure** (từ Messenger) và **3:00 PM Kim Tran — Bio Gel New Set** (từ Instagram)
- [ ] **Messenger bot → Conversations** → thấy hội thoại Messenger và hội thoại Instagram, mỗi cái có **huy hiệu kênh** riêng
- [ ] **Activity log** → cột **Channel** có cả `Messenger` và `Instagram`, có dòng `Outgoing · Sent`

---

# LƯU Ý CUỐI

- Nếu bot **không trả lời một câu**: kiểm tra hội thoại có đang ở chế độ người thật không (Conversations → **Give back to bot**), rồi gõ lại câu **mới** — bot không trả lời lại tin cũ.
- Nếu bot báo giờ đó không đặt được: chọn giờ khác trong **9:00 AM – 6:00 PM**.
- Đừng gõ tiếng Việt trong video — reviewer là người nói tiếng Anh, toàn bộ hội thoại nên bằng tiếng Anh.
