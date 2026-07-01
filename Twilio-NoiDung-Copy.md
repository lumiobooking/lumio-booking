# Twilio Toll‑Free — Nội dung dán vào form (copy sẵn)
**Số:** +1 833 719 5153 · **Lỗi bị từ chối:** *End Business Details Must Be Accurate and Complete* (30474)

> ⚠️ **QUAN TRỌNG — tôi đã kiểm chứng trực tiếp trong tài khoản:**
> Khối **“Business information”** (tên công ty, EIN, địa chỉ, người liên hệ) đã được Twilio **duyệt và KHÓA**. Nếu anh sửa bất kỳ ô nào trong khối đó rồi bấm Submit, Twilio báo lỗi *“customer profile … cannot be edited”* và **không nộp được**. Vì vậy:
> - **KHÔNG sửa** khối Business information (để nguyên).
> - Chỉ **sửa/thêm** ở khối **Messaging use case** bên dưới.
> - Ô **Terms and conditions URL đang TRỐNG** → đây là thứ cần thêm.

---

## A. BUSINESS INFORMATION — ĐỂ NGUYÊN, KHÔNG SỬA
(chỉ liệt kê để anh đối chiếu — sửa là hỏng)

- Legal business name: `Lumio Agency`
- Company type: `PRIVATE_PROFIT`
- Business registration ID type: `USA: EIN`
- EIN: `384379272`
- Business website URL: `https://lumioagency.com/`
- Address: `5900 Balcones Drive, ste 100, Austin, TX 78731, United States`
- Contact: `HUY CAN TRAN` · `lumioagency.com@gmail.com` · `+84 0868 488 881`

---

## B. MESSAGING USE CASE — SỬA/THÊM CÁC Ô SAU

### 1) Use case description  *(sửa lại — đây là phần chính để hết lỗi 30474)*
```
Lumio Agency operates Lumio Booking (lumiobooking.com), a US-based appointment-booking and salon-management software used by nail salons in the United States. Lumio Agency uses this toll-free number to send transactional appointment messages — confirmations, reminders, reschedules, and cancellations — to the salon customers who book through Lumio Booking, and, only to customers who separately opt in, occasional promotional offers. Lumio Agency owns and directly operates the opt-in: a public web consent form at https://lumiobooking.com/sms-optin and a consent step inside the online booking flow at lumiobooking.com. Lumio Agency is the sole creator of all message content, generated from standardized templates. Consumers provide their mobile number and give express written consent by actively checking an unchecked box before any message is sent; consent is stored with a timestamp and is never a condition of any purchase. Every message identifies the program as "Lumio Booking" and includes STOP (opt-out) and HELP instructions.
```

### 2) Sample message  *(giữ hoặc thay bằng bản này — có brand + STOP + HELP)*
```
Lumio Booking: Hi Jane, a reminder of your Manicure appointment at Rose Nails on Fri Jul 10 at 2:00 PM. Reply STOP to opt out, HELP for help.
```

### 3) Opt-in type
```
Web form
```

### 4) Opt-in policy proof  *(đã đúng — giữ nguyên)*
```
https://lumiobooking.com/sms-optin
```

### 5) Terms and conditions URL  *(ĐANG TRỐNG → THÊM VÀO)*
```
https://lumiobooking.com/terms
```

### 6) Privacy policy URL  *(đã đúng — giữ nguyên)*
```
https://lumiobooking.com/privacy
```

### 7) List all opt-in keywords
```
START, STOP, HELP
```

### 8) What is the opt-in message?  *(đang trống → thêm)*
```
Lumio Booking: You're now subscribed to appointment text alerts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.
```

### 9) What is the help message?  *(đã đúng — giữ nguyên)*
```
Lumio Booking: You are receiving appointment booking messages from Lumio Booking. For help, visit https://lumiobooking.com/support or contact support@lumioagency.com. Reply STOP to opt out.
```

### 10) Age gated content
```
KHÔNG tick (để trống)
```

### 11) Additional information  *(thay bằng bản này — chỉ thẳng reviewer tới trang bằng chứng)*
```
Lumio Agency is the business operating this number. Compliance proof pages are public: opt-in consent form https://lumiobooking.com/sms-optin, Privacy Policy https://lumiobooking.com/privacy, Terms https://lumiobooking.com/terms, Support/HELP https://lumiobooking.com/support. Messages are transactional appointment notifications for salon customers who opt in during booking; promotional texts go only to customers who check a separate, unchecked consent box. Opt-in is never required for any purchase and consent is stored with a timestamp.
```

### 12) Notification email  *(giữ nguyên)*
```
lumioagency.com@gmail.com
```

---

## C. Sau khi dán xong
1. Tick ô **“I confirm the information entered here is ready to submit for review.”**
2. Bấm **Submit registration**.
3. Nộp lại **trước 2026‑07‑08** để vào hàng ưu tiên.

---

## D. 2 điểm có thể vẫn khiến bị soi (để anh biết trước)
1. **Business website = `lumioagency.com`** (không phải lumiobooking.com). Reviewer sẽ mở trang này. Hãy đảm bảo **lumioagency.com có link tới** Privacy/Terms/SMS opt‑in (hoặc nhắc tới dịch vụ Lumio Booking). Nếu muốn đổi ô website sang `lumiobooking.com` thì **phải sửa trong TrustHub → Customer Profile** (vì hồ sơ đã duyệt nên có thể phải liên hệ Twilio Support) — không sửa được trong form này.
2. **Số điện thoại liên hệ là số Việt Nam (+84).** Doanh nghiệp Mỹ (EIN + địa chỉ Texas) mà số VN có thể bị cho là “chưa nhất quán”. Số này cũng nằm trong hồ sơ đã khóa; muốn đổi sang số US phải sửa ở TrustHub Customer Profile.

*Hai điểm trên nằm trong hồ sơ đã khóa nên form không cho sửa. Nếu nộp lại (theo mục B) mà vẫn bị từ chối vì “end business”, bước tiếp theo là vào **TrustHub → Customer Profile** cập nhật website/điện thoại (hoặc mở ticket Twilio Support), hoặc chuyển hướng xác minh theo **một tiệm thật** (Path B trong file kia).*

*Lưu ý: tôi không phải chuyên gia pháp lý/viễn thông; quyết định duyệt cuối cùng thuộc về Twilio.*
