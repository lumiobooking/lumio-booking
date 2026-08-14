# AI Hotline — thiết lập trong hệ thống, bàn giao khách, và luật hoạt động

Twilio đã dựng xong. Tài liệu này nói phần còn lại: cấu hình trong Lumio, việc khách phải làm, và **chính xác** tổng đài quyết định thế nào ở từng tình huống.

Phần "luật hoạt động" được viết từ chính code đang chạy, không phải mô tả chung.

---

# PHẦN 1 — THIẾT LẬP TRONG HỆ THỐNG

## 1.1 Super Admin: gán số cho tiệm

**Super Admin → Tenants → chọn tiệm → mục AI Hotline**

| Việc | Chi tiết |
|---|---|
| Gán số | Dán số Twilio đúng dạng **E.164**: `+18337195153` — có dấu cộng, không dấu cách, không gạch |
| Phút bao gồm | Số phút AI trong gói mỗi tháng. `0` = không giới hạn |
| SMS bao gồm | Số tin nhắn trong gói. `0` = không giới hạn |
| Giá vượt mức | Tính bằng cent cho mỗi phút / mỗi tin vượt |
| Phí add-on | Phí hotline hàng tháng. `0` = đã gộp trong gói |
| Chặn cứng | Bật = **ngừng nhận cuộc gọi AI mới** khi hết phút. Tắt = vẫn nhận, tính vượt mức |

Một số chỉ gán được cho **một tiệm**. Gán số đang thuộc tiệm khác sẽ báo lỗi.

> **Chặn cứng nên bật cho gói thấp.** Không có nó, một tiệm bị gọi rác có thể ăn hết lãi của cả tháng. Cuộc gọi **đang diễn ra không bao giờ bị cắt** — chỉ chặn cuộc mới.

## 1.2 Tài khoản tiệm: cách trả lời

**Đăng nhập tài khoản tiệm → AI Hotline**

### Chế độ (mode)

| Chế độ | Hệ thống làm gì | Dùng khi |
|---|---|---|
| **AI trả lời ngay** | AI bắt máy luôn | Tiệm đã cài nhà mạng chuyển hướng lúc không ai bắt. Máy tiệm đã reo trước ở phía nhà mạng rồi |
| **Đổ chuông tiệm trước** | Lumio gọi số của tiệm trước, chờ 5–60 giây, không ai bắt thì AI vào | Muốn kiểm soát chính xác số hồi chuông |
| **Chỉ chuyển máy** | Không bao giờ dùng AI — đổ chuông rồi voicemail | Tiệm chỉ muốn hộp thư thoại |

Chế độ "Đổ chuông tiệm trước" và "Chỉ chuyển máy" cần điền **danh sách số của tiệm**, cách nhau bằng dấu phẩy.

### Khung giờ AI được phép trả lời

- **Luôn luôn** — mọi lúc
- **Trong giờ mở cửa** — theo đúng giờ làm việc và ngày nghỉ của tiệm trong Settings
- **Ngoài giờ** — ngược lại; AI chỉ trực lúc tiệm đóng
- **Tuỳ chỉnh** — đặt riêng từng ngày trong tuần, hỗ trợ **khung qua đêm** (18:00 → 09:00)

### Khi AI không trả lời

- **Voicemail** — phát lời nhắn rồi ghi âm; có ô số nhận tin báo khi có voicemail mới
- **Chỉ phát thông báo** — nói một câu rồi cúp
- **Cúp máy** — cúp ngay

### Lời chào

Ô lời chào là phần **sau** câu tiết lộ. Hệ thống **luôn tự động** ghép câu tiết lộ AI vào đầu, không tắt được:

> *"Hi, thanks for calling [Tên tiệm]! Just so you know, you're speaking with our friendly automated booking assistant."* + lời chào của tiệm

Đây là chủ ý — luật tiết lộ AI ở California và Texas. Không cho tiệm tắt.

---

# PHẦN 2 — VIỆC CỦA KHÁCH

Khách chỉ làm **một việc**, khoảng 2 phút, bấm ngay trên máy: bật chuyển hướng **"không ai trả lời → số Lumio"** trên đường dây tiệm.

Gửi khách file `Lumio-HuongDan-Setup-AI-Hotline.pdf` kèm số Lumio của họ.

**Ba điều phải nói rõ với khách:**

1. **Số tiệm không đổi.** Khách của họ vẫn gọi số cũ, không cần port, không cần báo ai.
2. **Số Lumio không phải để quảng cáo.** Đừng in lên bảng hiệu hay Google Maps — nó chỉ là nơi cuộc gọi rơi xuống khi tiệm không bắt máy.
3. **Hỏi nhà mạng** xem cuộc chuyển hướng có tính phút không. Thường nằm trong gói unlimited, nhưng hỏi một câu cho chắc.

---

# PHẦN 3 — LUẬT HOẠT ĐỘNG

## 3.1 Cuộc gọi đi qua những cửa nào

Khi một cuộc gọi rơi vào số Lumio, hệ thống chạy qua các cửa sau, **theo đúng thứ tự**. Trượt cửa nào là rẽ sang nhánh "không trả lời" ngay.

```
Cuộc gọi tới số Lumio
   │
   ├─ Số này thuộc tiệm nào?          ── không tìm thấy → xin lỗi, cúp máy
   │
   ├─ Chế độ = "Chỉ chuyển máy"?      ── đổ chuông tiệm → hết → voicemail
   │
   ├─ Chế độ = "Đổ chuông trước"?     ── đổ chuông tiệm trước
   │        └─ có người bắt  → xong, AI không xen vào
   │        └─ không ai bắt / máy bận / từ chối → xuống cửa tiếp
   │
   ├─ Hotline có đang BẬT không?      ── tắt → nhánh không trả lời
   │
   ├─ Có đang trong KHUNG GIỜ cho phép? ── ngoài giờ → nhánh không trả lời
   │
   ├─ Chặn cứng bật & đã hết phút?    ── hết → nhánh không trả lời
   │
   └─ AI bắt máy: tiết lộ AI + lời chào
```

Điểm đáng chú ý: **cả ba cửa cuối đều dẫn về cùng một nhánh** "không trả lời" — voicemail, phát thông báo, hoặc cúp, tuỳ tiệm đặt. Nên tiệm nào chọn voicemail thì khách luôn để lại được lời nhắn, kể cả khi hotline hết phút.

## 3.2 AI làm được gì trong cuộc gọi

**Làm được:**

- Trả lời về **dịch vụ và giá** — đọc từ bảng dịch vụ thật của tiệm, tối đa 40 dịch vụ
- **Đặt lịch hẹn** — cần đủ ba thứ: tên, dịch vụ, ngày giờ cụ thể. Hỏi từng thứ một, nhắc lại để xác nhận
- Sau khi đặt xong: nhắc lại ngày giờ, báo **sẽ có tin nhắn xác nhận**, rồi hỏi còn cần gì nữa — **không cúp máy ngay** sau khi đặt
- Kết thúc cuộc gọi khi khách đã xong

**Không làm được:**

- Không sửa hay huỷ lịch hẹn đã có
- Không nhận thanh toán
- Không trả lời ngoài dữ liệu của tiệm — giá, giờ, dịch vụ đều phải có trong hệ thống

## 3.3 Khi khách im lặng

Khách không nói gì, hệ thống hỏi lại. Sau **2 lần hỏi lại** vẫn im thì chào và cúp máy lịch sự. Điều này tránh cuộc gọi treo vô hạn ăn phút của tiệm.

## 3.4 Ghi nhận và tính phí

- Mọi cuộc gọi được ghi vào lịch sử kèm **thời lượng** và **kết quả** (đặt được lịch / voicemail / cúp)
- Voicemail được **ghi âm** và có thể nhắn tin báo về số đã đặt
- Phút tính theo tháng, so với hạn mức trong gói; vượt thì tính theo giá vượt mức

## 3.5 An toàn

Mọi webhook thoại đều được **kiểm chữ ký `X-Twilio-Signature`** khi biến `TWILIO_AUTH_TOKEN` đã đặt trên Render. Không có bước này, bất kỳ ai biết số Lumio của tiệm đều có thể giả cuộc gọi để tạo lịch hẹn thật và đội chi phí. **Đừng bao giờ chạy thật khi thiếu biến này.**

---

# PHẦN 4 — CẤU HÌNH GỢI Ý THEO KIỂU TIỆM

| Kiểu tiệm | Chế độ | Khung giờ | Không trả lời |
|---|---|---|---|
| Tiệm đông, sợ mất cuộc gọi giờ cao điểm | AI trả lời ngay | Luôn luôn | Voicemail |
| Tiệm muốn người bắt máy trước | Đổ chuông trước, 20 giây | Luôn luôn | Voicemail |
| Tiệm chỉ cần trực ngoài giờ | AI trả lời ngay | Ngoài giờ | Voicemail |
| Tiệm chưa tin AI, muốn thử | Đổ chuông trước, 30 giây | Ngoài giờ | Voicemail |

**Với tiệm mới, nên bắt đầu bằng dòng cuối.** Người bắt máy trước, AI chỉ đỡ ngoài giờ. Tiệm thấy nó chạy đúng rồi mới mở rộng — bán như vậy dễ hơn nhiều so với bảo họ giao hết cuộc gọi cho máy ngay từ ngày đầu.

---

# PHẦN 5 — KIỂM TRA TRƯỚC KHI BÀN GIAO

- [ ] Gọi vào số Lumio → AI bắt máy, **có câu tiết lộ trợ lý tự động**
- [ ] Hỏi giá một dịch vụ → đọc **đúng giá trong hệ thống tiệm**
- [ ] Đặt thử một lịch → lịch hiện trong **Calendar** của tiệm
- [ ] Sau khi đặt, AI **không cúp ngay** mà hỏi còn cần gì nữa
- [ ] Im lặng 2 lượt → AI chào và cúp lịch sự
- [ ] Cúp máy → cuộc gọi hiện trong lịch sử, có thời lượng và kết quả
- [ ] Nếu chọn "Đổ chuông trước": máy tiệm có reo, AI chỉ vào sau khi không ai bắt
- [ ] Đặt khung giờ ngoài giờ hiện tại → gọi vào phải rơi vào voicemail, không phải AI
