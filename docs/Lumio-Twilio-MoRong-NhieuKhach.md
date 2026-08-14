# Mở rộng AI Hotline cho nhiều tiệm — quy trình vận hành

Tiếp nối `Lumio-Twilio-AI-Hotline-Runbook.md` (dựng cho MỘT tiệm). Tài liệu này nói về việc chạy hàng chục tới hàng trăm tiệm mà không chết vì thao tác tay.

---

# Điều quan trọng nhất phải hiểu trước

**Mỗi tiệm cần MỘT số Twilio riêng.** Không chia sẻ số được.

Lý do nằm trong cách hệ thống định tuyến: khi cuộc gọi tới, Twilio gửi số **được gọi** (`To`) về Lumio, hệ thống tra bảng `voice_lines` xem số đó thuộc tiệm nào, rồi lấy đúng dịch vụ, giá, giờ mở cửa và lịch của tiệm ấy. Số là **chìa khoá nhận diện tiệm** — không có gì khác trong cuộc gọi cho biết khách đang gọi tiệm nào.

Trong cơ sở dữ liệu, `lumioNumber` và `tenantId` đều là **duy nhất**: một số chỉ thuộc một tiệm, một tiệm chỉ có một số.

> **Hệ quả về chi phí:** 100 tiệm = 100 số. Đây là chi phí cố định hàng tháng, phải tính vào giá gói ngay từ đầu.

---

# 1. Chọn loại số — quyết định này khó đổi về sau

Bạn đang dùng **số toll-free** `+1 833 719 5153`. Với một số thì ổn. Với 100 số thì cần cân nhắc lại:

| | Số local | Số toll-free |
|---|---|---|
| Giá thuê / tháng | **~$1.15** | **~$2.00** |
| 100 số / tháng | ~$115 | ~$200 |
| Duyệt để gửi SMS | **A2P 10DLC** — một chiến dịch phủ **nhiều số** trong Messaging Service | **Toll-Free Verification** — duyệt **từng số một** |
| Công duyệt khi có 100 số | Làm **một lần** | Làm **100 lần** |
| Cảm giác của khách gọi | Số cùng vùng, quen thuộc | Số tổng đài |

**Khuyến nghị: chuyển sang số local cho các tiệm mới.**

Lý do chính không phải tiền thuê, mà là **công duyệt SMS**. Toll-free phải xác minh từng số; đến tiệm thứ 30 thì đó là 30 bộ hồ sơ. A2P 10DLC đăng ký **thương hiệu một lần** rồi **một chiến dịch** phủ toàn bộ số trong Messaging Service.

Chi phí A2P: đăng ký thương hiệu ~$4/tháng, mỗi chiến dịch ~$10/tháng — trả một lần cho cả trăm số.

Số toll-free hiện tại cứ giữ cho tiệm đang dùng, không cần đổi.

---

# 2. Sai lầm phải tránh: khai webhook thủ công cho từng số

Hướng dẫn một tiệm nói: mở số → dán URL `/api/voice/incoming`. Làm vậy với 100 số là 100 lần dán, và **ngày nào đổi tên miền API thì phải sửa lại đủ 100 lần**. Sót một cái là một tiệm chết hotline mà không ai biết.

## Cách đúng: dùng TwiML App làm điểm trung gian

Tạo **một** TwiML App, mọi số trỏ vào nó. Đổi URL thì sửa **một chỗ**, cả trăm số ăn theo.

**Tạo TwiML App**

1. Twilio Console → **Voice → TwiML → TwiML Apps → Create new**
2. Friendly name: `Lumio AI Hotline`
3. **Voice Request URL**:
   ```
   https://lumio-api-uqm6.onrender.com/api/voice/incoming
   ```
   Phương thức **HTTP POST**
4. **Status Callback URL**:
   ```
   https://lumio-api-uqm6.onrender.com/api/voice/status
   ```
   POST
5. Save, chép lại **App SID** (`AP...`)

**Gán cho số**

Mỗi số: Voice Configuration → *Configure with* chọn **TwiML App** → chọn `Lumio AI Hotline`. Xong.

Từ nay mua số mới chỉ cần chọn app, không dán URL nữa.

---

# 3. Mua và cấu hình số hàng loạt

Với 5 tiệm trở lên, đừng bấm tay. Dùng Twilio CLI.

```bash
# cài một lần
npm install -g twilio-cli
twilio login          # dán Account SID + Auth Token

# tìm số local ở vùng khách (ví dụ mã vùng 408)
twilio api:core:available-phone-numbers:local:list \
  --country-code US --area-code 408 --sms-enabled --voice-enabled

# mua số và gắn thẳng TwiML App
twilio api:core:incoming-phone-numbers:create \
  --phone-number "+14085551234" \
  --voice-application-sid APxxxxxxxxxxxxxxxx \
  --friendly-name "Bellagio Nails - Riverbank"
```

**Đặt Friendly name = tên tiệm.** Sáu tháng nữa nhìn danh sách 80 số, không có tên thì không biết số nào của ai, và không ai dám xoá số nào.

Đổi URL cho toàn bộ số sau này: sửa trong TwiML App, không cần đụng tới số.

---

# 4. SMS ở quy mô nhiều tiệm — một điểm cần biết

Hệ thống hiện gửi SMS bằng **một** cấu hình Twilio dùng chung (biến `TWILIO_MESSAGING_SERVICE_SID` hoặc `TWILIO_FROM_NUMBER` trên Render).

Nghĩa là: **tin nhắn xác nhận lịch gửi cho khách của mọi tiệm đều đi từ cùng một số**, không phải từ số hotline riêng của từng tiệm.

Chấp nhận được hay không tuỳ bạn:

- **Chấp nhận được**, nếu nội dung tin có ghi rõ tên tiệm ("Bellagio Nails: lịch hẹn của bạn..."). Đây là cách hầu hết nền tảng đặt lịch làm.
- **Không ổn**, nếu khách bấm gọi lại vào số nhắn tin và rơi vào tổng đài của tiệm khác.

> Trong Settings của từng tiệm có chỗ nhập **Twilio riêng của tiệm** (Account SID / Auth token / From number). Tiệm nào muốn tin nhắn đi từ số của chính họ thì khai ở đó — hệ thống ưu tiên cấu hình riêng trước khi dùng cấu hình chung.

**Với hàng loạt tiệm dùng chung:** tạo **một Messaging Service**, thả các số vào pool, đăng ký **một chiến dịch A2P** cho service đó. Đặt `TWILIO_MESSAGING_SERVICE_SID` trỏ vào service này.

---

# 5. Quy trình chuẩn cho mỗi tiệm mới (sau khi đã dựng xong phần chung)

Khi TwiML App và Messaging Service đã có, mỗi tiệm mới chỉ còn 5 phút:

1. Mua số local vùng của tiệm, gắn TwiML App, đặt Friendly name = tên tiệm
2. Thêm số vào Messaging Service (nếu tiệm dùng SMS)
3. Super Admin → Tenants → tiệm → gán số (E.164) + đặt hạn mức phút/SMS
4. Tài khoản tiệm → AI Hotline: chế độ trả lời, khung giờ, lời chào có tiết lộ AI
5. Gọi thử: bắt máy → đúng giá → đặt được lịch → hiện trong Calendar
6. Gửi khách `Lumio-HuongDan-Setup-AI-Hotline.pdf` + số Lumio của họ

---

# 6. Bảng theo dõi số — làm ngay từ tiệm thứ hai

Twilio không biết tiệm nào là tiệm nào. Giữ một bảng tính:

| Số Twilio | Tiệm | Loại | Ngày cấp | SMS đã duyệt | Ghi chú |
|---|---|---|---|---|---|
| +1 833 719 5153 | (tiệm đang dùng) | Toll-free | | | Số đầu tiên |
| | | | | | |

Không có bảng này thì đến tiệm thứ 20 sẽ có ít nhất một số trả tiền hàng tháng mà không ai nhớ nó phục vụ ai.

---

# 7. Kiểm soát chi phí

Chi phí tăng theo ba trục: **số thuê bao**, **phút gọi**, **tin nhắn**.

- Đặt **hạn mức phút** cho từng tiệm trong Super Admin, và bật **chặn cứng** với tiệm gói thấp. Không có hạn mức thì một tiệm bị gọi rác có thể ăn hết lãi của cả tháng.
- Bật **cảnh báo số dư** trong Twilio (Usage Triggers). Hết tiền là **toàn bộ tiệm mất hotline cùng lúc** — sự cố tệ nhất có thể xảy ra với dịch vụ này.
- Xem lại số không dùng mỗi quý: tiệm ngừng hợp đồng thì **trả số về Twilio**, đừng để nó âm thầm tính tiền.

---

# 8. Trước khi bán hotline cho tiệm tiếp theo

- [ ] Đã tạo TwiML App và mọi số hiện có đều trỏ vào nó
- [ ] Đã quyết định dùng số local cho tiệm mới
- [ ] Đã đăng ký A2P 10DLC (nếu bán kèm SMS) — nhớ chờ 10–15 ngày
- [ ] Đã tạo Messaging Service và đặt biến trên Render
- [ ] Đã có bảng theo dõi số ↔ tiệm
- [ ] Đã bật Auto-recharge và cảnh báo số dư
- [ ] Đã đặt hạn mức phút cho từng gói bán ra
