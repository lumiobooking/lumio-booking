# Dựng số AI Hotline trên Twilio — quy trình nội bộ Lumio Agency

Tài liệu này dành cho **bạn**, không đưa khách. Nó đi từ lúc mở tài khoản Twilio tới lúc bàn giao số cho một tiệm.
Phần khách tự làm (bật chuyển hướng trên đường dây tiệm) đã có tài liệu riêng: `Lumio-HuongDan-Setup-AI-Hotline.pdf`.

> **Mốc thời gian cần biết trước khi hứa với khách:** phần gọi thoại chạy được **ngay trong ngày**. Phần **nhắn tin SMS** phải đăng ký với nhà mạng Mỹ và **duyệt mất 10–15 ngày**. Đừng hứa khách có SMS xác nhận trong tuần đầu.

---

# PHẦN A — Làm MỘT LẦN cho cả công ty

Làm xong phần này là dùng chung cho mọi tiệm về sau. Mỗi tiệm mới chỉ cần Phần B.

## A1. Tài khoản Twilio

1. Đăng ký tại `twilio.com` bằng email công ty (không dùng email cá nhân — sau này bàn giao nội bộ sẽ kẹt).
2. Nâng lên tài khoản trả tiền (**Upgrade**). Tài khoản dùng thử chỉ gọi được vào số đã xác minh — không dùng cho khách thật được.
3. Nạp tiền và **bật Auto-recharge**. Hết tiền giữa chừng là toàn bộ hotline của mọi tiệm chết cùng lúc.
4. Bật **2FA** cho tài khoản. Ai chiếm được tài khoản này thì nghe được cuộc gọi của mọi tiệm.

## A2. Khai hồ sơ doanh nghiệp (Business Profile)

Vào **Trust Hub → Business Profile**, khai thông tin công ty:

- Tên pháp lý, **EIN**, địa chỉ Mỹ
- Website: `lumiobooking.com` — website phải **sống** và có **trang chính sách bảo mật** công khai, nhà mạng có kiểm tra
- Người đại diện + email + số điện thoại

Hồ sơ này là nền cho mọi bước duyệt sau. Khai sai tên/EIN là bị từ chối và phải làm lại từ đầu.

## A3. Biến môi trường trên Render (`lumio-api`)

| Biến | Giá trị | Dùng để làm gì |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `AC...` | Gửi SMS |
| `TWILIO_AUTH_TOKEN` | (token) | Gửi SMS **và xác thực chữ ký webhook** |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG...` | Gửi SMS qua Messaging Service (khuyên dùng) |
| `TWILIO_FROM_NUMBER` | `+1...` | Số gửi SMS, nếu không dùng Messaging Service |
| `SMS_PROVIDER` | `twilio` | Bật nhà cung cấp SMS |
| `PUBLIC_API_URL` | `https://lumio-api-uqm6.onrender.com` | Địa chỉ hệ thống dùng để dựng webhook |

**`TWILIO_AUTH_TOKEN` là biến quan trọng nhất về mặt an toàn.** Khi có nó, hệ thống kiểm chữ ký `X-Twilio-Signature` trên mọi webhook thoại. Thiếu nó, bất kỳ ai biết số Lumio của tiệm đều có thể giả cuộc gọi để tạo lịch hẹn thật, gửi SMS, và đội chi phí lên. Đừng bao giờ chạy thật mà không đặt biến này.

> Có công tắc tắt kiểm chữ ký (`VOICE_VERIFY_SIGNATURE=false`) — chỉ dùng khi đang gỡ lỗi, và **phải bật lại ngay**.

---

# PHẦN B — Làm cho TỪNG TIỆM

## B1. Mua số

**Phone Numbers → Buy a number.**

Chọn kiểu số:

| | Số local (vùng của tiệm) | Số toll-free (833/844/855…) |
|---|---|---|
| Cảm giác của khách | Số địa phương, quen thuộc | Số tổng đài, chuyên nghiệp hơn |
| Gọi thoại | Chạy ngay | Chạy ngay |
| Muốn gửi SMS | Phải đăng ký **A2P 10DLC** | Phải làm **Toll-Free Verification** |
| Chi phí/tháng | Rẻ hơn | Cao hơn một chút |

**Khuyên dùng số local cùng vùng với tiệm.** Khách gọi lỡ nhìn thấy số lạ khác bang sẽ ngại.

Khi mua nhớ tick **Voice** trong phần khả năng của số.

## B2. Trỏ webhook về Lumio

Mở số vừa mua → phần **Voice Configuration**:

- **A call comes in**: chọn **Webhook**
- URL:
  ```
  https://lumio-api-uqm6.onrender.com/api/voice/incoming
  ```
- Phương thức: **HTTP POST**
- **Call status changes** (tuỳ chọn, nên đặt):
  ```
  https://lumio-api-uqm6.onrender.com/api/voice/status
  ```
  POST — dùng để ghi nhận thời lượng cuộc gọi phục vụ tính phút.

Bấm **Save**. Đây là toàn bộ phần cấu hình trên Twilio — các webhook còn lại (`/turn`, `/after-dial`, `/voicemail`) hệ thống tự dựng trong lúc gọi, **không cần khai**.

## B3. Gán số cho tiệm trong Lumio

Đăng nhập **Super Admin → Tenants → chọn tiệm → mục AI Hotline**:

1. Dán số vừa mua vào ô số, đúng dạng **E.164**: `+14085551234` — có dấu `+`, có mã quốc gia, không dấu cách, không gạch.
2. Bấm gán số.
3. Đặt hạn mức gói: số phút bao gồm, số SMS bao gồm, giá vượt mức, và `hardCap` nếu muốn chặn cứng khi hết phút.

Một số chỉ gán được cho **một tiệm**. Hệ thống sẽ báo lỗi nếu số đó đang thuộc tiệm khác.

## B4. Cấu hình cách trả lời (trong tài khoản tiệm)

Vào tài khoản tiệm → **AI Hotline**:

**Chế độ trả lời** — chọn một trong ba:

- **AI trả lời ngay** — dùng khi tiệm đã đặt nhà mạng chuyển hướng lúc không ai bắt máy. Máy tiệm reo trước ở phía nhà mạng, nên AI chỉ nhận cuộc đã rơi.
- **Đổ chuông tiệm trước** — Lumio gọi vào máy tiệm trước, sau `ringSeconds` giây (5–60) không ai bắt thì AI vào. Dùng khi muốn kiểm soát chính xác số hồi chuông.
- **Chỉ chuyển máy** — không dùng AI, chỉ đổ chuông rồi voicemail.

**Khung giờ AI được phép trả lời**: luôn luôn / trong giờ mở cửa / ngoài giờ / tuỳ chỉnh từng ngày.

**Khi không ai trả lời**: để lại lời nhắn (voicemail) / phát một câu thông báo / cúp máy. Có ô số điện thoại nhận tin báo khi có voicemail.

**Lời chào** — bắt buộc phải nói rõ đây là trợ lý tự động. Đừng bỏ phần này: nhiều bang ở Mỹ yêu cầu tiết lộ, và khách phát hiện bị giấu sẽ mất thiện cảm với tiệm.

## B5. Gọi thử trước khi bàn giao

Gọi từ điện thoại cá nhân vào **số Twilio vừa mua** và kiểm đủ:

- [ ] AI bắt máy, đọc đúng lời chào và nói rõ là trợ lý tự động
- [ ] Hỏi giá một dịch vụ → đọc **đúng giá trong hệ thống tiệm**
- [ ] Đặt thử một lịch → lịch hiện trong **Calendar** của tiệm
- [ ] Cúp máy → cuộc gọi hiện trong mục **lịch sử cuộc gọi**, có thời lượng
- [ ] Nếu chọn "Đổ chuông tiệm trước": máy tiệm có reo, và AI chỉ vào sau khi không ai bắt

## B6. Bàn giao cho tiệm

Gửi khách file `Lumio-HuongDan-Setup-AI-Hotline.pdf` và số Lumio của họ. Việc của khách chỉ có một: bật chuyển hướng "không ai trả lời → số Lumio" trên đường dây tiệm, bấm ngay trên máy, khoảng 2 phút.

Nhắc khách hai điều:

- **Số tiệm không đổi.** Khách của họ vẫn gọi số cũ. Số Lumio chỉ là nơi cuộc gọi rơi xuống.
- **Hỏi nhà mạng** xem cuộc gọi chuyển hướng có tính phút không (thường nằm trong gói unlimited).

---

# PHẦN C — SMS: phần chậm nhất, làm sớm

Gọi thoại chạy ngay. **Nhắn tin thì không** — nhà mạng Mỹ bắt đăng ký trước.

## Nếu dùng số local → A2P 10DLC

**Messaging → Regulatory Compliance → A2P 10DLC.**

Cần chuẩn bị:

- Business Profile ở bước A2 đã duyệt
- Mô tả rõ mục đích nhắn tin: xác nhận lịch hẹn, nhắc hẹn, mời đánh giá
- **Bằng chứng khách đồng ý nhận tin (opt-in)** — chụp màn hình form đặt lịch chỗ có ô tích đồng ý
- Mẫu tin nhắn thật sẽ gửi
- Website sống có chính sách bảo mật

**Duyệt mất 10–15 ngày.** Nộp sớm, đừng chờ tới lúc có khách mới làm.

## Nếu dùng số toll-free → Toll-Free Verification

Số toll-free **không** thuộc hệ A2P 10DLC, nhưng vẫn phải xác minh riêng thì tin mới đi được đủ tốc độ. Hồ sơ tương tự.

## Lỗi hay gặp khi bị từ chối

- Website không có trang chính sách bảo mật, hoặc có mà không truy cập được
- Không chứng minh được khách đã đồng ý nhận tin
- Mô tả mục đích chung chung kiểu "gửi thông báo cho khách hàng"
- Tên công ty hoặc EIN khai không khớp giấy tờ

---

# Sự cố thường gặp

| Hiện tượng | Nguyên nhân hay gặp nhất |
|---|---|
| Gọi vào không ai bắt, Twilio báo lỗi | Webhook sai đường dẫn, hoặc để GET thay vì POST |
| Gọi vào im lặng rồi cúp | `lumio-api` đang ngủ hoặc lỗi — xem log trên Render |
| AI trả lời nhưng báo sai giá | Tiệm chưa nhập dịch vụ, hoặc đang xem nhầm tiệm |
| Không tạo được lịch hẹn | Ngoài giờ mở cửa của tiệm, hoặc dịch vụ chưa bật |
| SMS không tới | Chưa duyệt A2P/toll-free, hoặc thiếu biến `SMS_PROVIDER=twilio` |
| Số bị từ chối khi gán | Số đó đã gán cho tiệm khác — gỡ ở tiệm cũ trước |
| Gán số báo lỗi định dạng | Phải đúng E.164: `+14085551234` |

---

# Bảng kiểm nhanh cho một tiệm mới

- [ ] Mua số trên Twilio, tick khả năng **Voice**
- [ ] Trỏ **A call comes in** → `https://lumio-api-uqm6.onrender.com/api/voice/incoming`, **POST**
- [ ] Trỏ **Call status changes** → `.../api/voice/status`, POST
- [ ] Super Admin → gán số cho tiệm (E.164) + đặt hạn mức gói
- [ ] Tài khoản tiệm → AI Hotline: chọn chế độ, khung giờ, lời chào có tiết lộ AI
- [ ] Gọi thử: bắt máy → báo đúng giá → đặt được lịch → hiện trong Calendar
- [ ] Gửi khách file hướng dẫn bật chuyển hướng
- [ ] Nếu tiệm cần SMS: nộp hồ sơ A2P / toll-free ngay, báo trước là chờ 10–15 ngày
