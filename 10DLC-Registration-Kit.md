# Lumio Booking — A2P 10DLC Registration Kit (Twilio / TCR)

> Hướng dẫn bằng tiếng Việt — **phần nội dung in đậm/khối code là English, copy thẳng vào form Twilio**.
> Mục tiêu: được duyệt ngay, không bị từ chối.

---

## 0. Việc cần làm trước khi submit (BẮT BUỘC)

10DLC bị từ chối nhiều nhất vì reviewer **mở website lên không thấy** chính sách + opt-in. Trước khi nộp form:

1. **Deploy bản mới** (chạy `deploy.bat`). Sau khi Render build xong, mở thử 3 link này, phải hiện ra trang:
   - `https://lumiobooking.com/sms-optin`  ← **trang form đăng ký SMS (dùng làm Opt-in policy proof)**
   - `https://lumiobooking.com/privacy`
   - `https://lumiobooking.com/terms`
2. Mở 1 trang booking thật, ví dụ `https://lumiobooking.com/book/ten-tiem`, tới **bước "Your information"** — phải thấy ô tick SMS + dòng "Reply STOP to opt out" + link Privacy/Terms.

Nếu reviewer không mở được các trang này → **rớt**. Nên đây là điều kiện tiên quyết.

> **Trang `/sms-optin` được thiết kế giống y mẫu Twilio yêu cầu** (ô số điện thoại + ô tick KHÔNG check sẵn + mô tả loại tin + tần suất + phí + HELP/STOP + link Terms/Privacy + nút "Yes, sign me up!"). Đây là link bạn dán vào ô **"Opt-in policy proof"**.

---

## 1. Brand (Đăng ký thương hiệu)

| Field | Giá trị nhập |
|---|---|
| Legal business name | **Lumio Agency** (đúng tên pháp lý trên giấy tờ) |
| Business type | Sole Proprietor / LLC… (chọn đúng loại của bạn) |
| EIN / Tax ID | (số EIN của bạn — nếu Sole Prop chưa có EIN thì chọn Sole Proprietor) |
| Website | **https://lumiobooking.com** |
| Support email | **lumioagency.com@gmail.com** |
| Address / Phone | (địa chỉ + sđt doanh nghiệp của bạn) |

> Nếu bạn đăng ký dạng **Sole Proprietor**: giới hạn ~1 campaign, throughput thấp, không cần EIN. Để gửi nhiều tiệm/nhiều tin nên đăng ký **Standard (có EIN)**.

---

## 2. Campaign (Chiến dịch)

**Use case:** chọn **Mixed** (vừa nhắc lịch hẹn vừa khuyến mãi).
*(Nếu form bắt chọn lại: Customer Care + Marketing.)*

**Campaign description** — copy:

```
Lumio Booking is appointment-booking software used by nail salons. We send appointment
confirmations, reminders, and schedule updates to customers who book an appointment with a
salon through our online booking page, and promotional offers to customers who separately
opt in. Customers provide their mobile number and consent on the salon's online booking form
at lumiobooking.com. Consent is never shared with third parties.
```

**Message frequency** — copy:

```
Message frequency varies, typically 1 to 5 messages per appointment or per month.
```

---

## 3. Sample messages (dán 4 mẫu này)

```
1) Glamour Nails: your Gel Manicure on Mon, Jun 22 at 2:00 PM is booked. See you soon! Reply STOP to opt out.

2) Glamour Nails: reminder — Gel Manicure on Mon, Jun 22 at 2:00 PM. Confirm/cancel: https://lumiobooking.com/appt/ab12cd. Reply STOP to opt out.

3) Glamour Nails: a spot just opened! Book now: https://lumiobooking.com/book/glamour-nails. Reply STOP to opt out.

4) Happy birthday from Glamour Nails! Treat yourself to a visit on us. Reply STOP to unsubscribe.
```

> Đây đúng là các tin phần mềm đang gửi thật → khớp với hệ thống, reviewer kiểm tra sẽ thấy nhất quán.

---

## 4. Opt-in / Call-to-Action (Message Flow) — Ô QUAN TRỌNG NHẤT

Reviewer soi kỹ nhất ô này. Copy nguyên đoạn:

```
End users opt in via a web form. A public opt-in form is available at
https://lumiobooking.com/sms-optin, where the user enters their mobile phone number and actively
checks an unchecked consent box: "Yes, I would like to receive automated text messages from my salon
via Lumio Booking about my appointments (confirmations, reminders, updates) and promotional offers.
I understand I will receive up to 6 messages per month and that consent is not a condition of any
purchase." The form shows message frequency (up to 6/month), message-and-data-rate disclaimers,
HELP and STOP instructions, and links to our Terms of Service and Privacy Policy.

Customers also opt in while booking an appointment on their salon's online booking page
(e.g., https://lumiobooking.com/book/[salon]). On the "Your information" step the customer enters
their mobile number and sees the same disclosure, plus a separate, unchecked checkbox to also receive
promotional texts. The box is OFF by default and is NOT required to complete a booking. Opt-in and
consent data is never shared with third parties.
```

**Opt-in type:** Web form (online sign-up). Không phải keyword.

### Các ô URL (theo đúng form Twilio trong ảnh) — dán chính xác:

| Ô trong form Twilio | Dán giá trị |
|---|---|
| **Opt-in policy proof** | `https://lumiobooking.com/sms-optin` |
| **Terms and conditions URL** (optional) | `https://lumiobooking.com/terms` |
| **Privacy policy URL** (optional) | `https://lumiobooking.com/privacy` |

> Nếu Twilio vẫn muốn **ảnh chụp** bằng chứng opt-in: chụp màn hình trang `/sms-optin` (thấy rõ ô tick + dòng chữ), up lên Google Drive để **Public**, rồi dán thêm link Drive vào ô "Opt-in policy proof" (mỗi URL 1 dòng). Link `/sms-optin` đã là public sẵn nên thường không cần.

---

## 5. HELP & STOP replies

**HELP message** — copy:

```
Lumio Booking: For help, contact your salon or email lumioagency.com@gmail.com. Msg & data rates may apply. Reply STOP to opt out.
```

**STOP / opt-out confirmation** — copy:

```
You have been unsubscribed and will receive no further messages from this sender. Reply START to resubscribe.
```

> **Trong Twilio Messaging Service** → bật **Advanced Opt-Out** và đặt câu STOP ở trên (Twilio sẽ tự xử lý STOP/UNSTOP/HELP). Nên thêm brand name vào đầu câu nếu Twilio cho phép, ví dụ: `[Brand]: You have been unsubscribed...`.

---

## 6. Đã chỉnh trong phần mềm để đúng chính sách (đã code xong)

| Yêu cầu 10DLC | Đã làm |
|---|---|
| **Trang opt-in công khai 1 màn hình (proof)** giống mẫu Twilio | ✅ Trang `/sms-optin` mới — ô SĐT + ô tick không sẵn + tần suất + phí + HELP/STOP + link Terms/Privacy + nút "Yes, sign me up!" |
| Privacy Policy có câu "không chia sẻ dữ liệu opt-in SMS cho bên thứ ba" | ✅ Trang `/privacy` mới |
| Terms / SMS Messaging Terms (STOP, HELP, tần suất, phí) | ✅ Trang `/terms` mới |
| Opt-in rõ ràng tại nơi thu số ĐT (booking form) | ✅ Disclosure + ô tick **tắt sẵn**, **không bắt buộc** mới đặt được; có ghi tần suất "up to ~6/month" |
| Link Privacy/Terms/Text-Alerts công khai (footer trang chủ + trang booking) | ✅ |
| Tin nhắn có **tên tiệm (brand)** + **Reply STOP** | ✅ Tất cả mẫu SMS (xác nhận, nhắc lịch, waitlist, sinh nhật…) |
| Lưu bằng chứng đồng ý marketing | ✅ Lưu `smsConsent` + thời điểm vào hồ sơ khách |
| Marketing chỉ gửi khi khách tự tick | ✅ Tách riêng, mặc định OFF |

---

## 7. Lưu ý nhỏ giúp khỏi rớt

- **Không** để link rút gọn lạ (bit.ly…) trong tin — dùng domain `lumiobooking.com` (đã đúng).
- **Không** nhắn nội dung cấm (vay tiền, cần sa/CBD, cờ bạc…). Tiệm nail bình thường thì ổn.
- Brand name trên website, trong tin nhắn, và trong form phải **giống nhau**.
- Nếu bị hỏi thêm "proof of opt-in", gửi screenshot bước "Your information" của trang booking.
