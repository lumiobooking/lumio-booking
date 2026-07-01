# Khắc phục từ chối xác minh Toll‑Free (Twilio) — Reason 30474
**Số:** +1 833 719 5153 · **Account:** Lumio Agency
**Lỗi:** 30474 — *Need end business / End Business Details Must Be Accurate and Complete*

> ⚠️ Tôi (trợ lý) **không** đăng nhập được vào tài khoản Twilio của anh, nên các bước "nộp lại" anh tự bấm trong **Twilio Console → Trust Hub → Registrations → Edit & resubmit**. Toàn bộ **nội dung website** Twilio kiểm tra (opt‑in, Privacy, Terms, sample messages) tôi đã làm cho đạt chuẩn và deploy. Phần dưới là **text soạn sẵn để anh dán vào form** + thông tin doanh nghiệp cần điền.

---

## 1. Vì sao bị từ chối (ngắn gọn)
Twilio thấy đây là mô hình **ISV** (Lumio là phần mềm cho nhiều tiệm), nhưng ô thông tin doanh nghiệp lại điền **thông tin của Lumio/ISV** thay vì **doanh nghiệp thật sự gửi tin (end‑business)**, hoặc thông tin chưa đầy đủ/chính xác. **Một số toll‑free chỉ đại diện cho MỘT doanh nghiệp** — không thể dùng chung cho nhiều tiệm khác nhau.

## 2. Hai đường được duyệt — chọn 1

### 🅐 Số dùng chung, Lumio là "người vận hành chương trình" (ngoại lệ ISV) — nhanh nhất để chạy
Twilio cho phép **1 số đứng tên Lumio** NẾU hồ sơ chứng minh **Lumio tự quản lý opt‑in và là bên soạn toàn bộ nội dung tin**. Website của anh (opt‑in form + templates) đã đúng hướng này. Điền form theo **PHẦN 4 (Path A)** bên dưới.
*Rủi ro:* vì tin có gắn tên tiệm, một số reviewer vẫn có thể yêu cầu tách theo tiệm. Nếu bị từ chối lần nữa → chuyển sang 🅑.

### 🅑 Mỗi tiệm một danh tính người gửi — bài bản, mở rộng lâu dài
- **Cách chuẩn cho SaaS nhiều tiệm là A2P 10DLC**: Lumio là ISV, **mỗi tiệm đăng ký Brand + Campaign** (dùng số nội hạt 10 số). Tiệm nhỏ đăng ký dạng *Sole Proprietor* rẻ/nhanh.
- Hoặc **mỗi tiệm một số toll‑free** riêng, xác minh bằng thông tin thật của tiệm đó.
→ Khi anh muốn đi hướng này, báo tôi chỉnh phần mềm để **mỗi tiệm tự nhập thông tin người gửi + số riêng** (đúng kiến trúc multi‑tenant).

> **Khuyến nghị:** Muốn chạy pilot ngay → làm 🅐 (hoặc verify số này cho **một tiệm thật**). Khi lên nhiều tiệm → chuyển 🅑 (10DLC).

## 3. Bắt buộc trước khi nộp (cho ISV)
Tạo/duyệt **TrustHub → Primary Customer Profile** cho Lumio với **Business Identity = ISV**, và phải **Approved** trước khi nộp verification. (Twilio yêu cầu rõ điều này với reason 30474.)

---

## 4. Nội dung dán vào form (bằng tiếng Anh — vì Twilio + nhà mạng Mỹ duyệt tiếng Anh)

### Path A — đứng tên Lumio (ngoại lệ ISV)

**Business / end‑business information**
- Legal business name: `Lumio Agency` *(điền đúng TÊN PHÁP LÝ đã đăng ký — nếu là LLC/Corp thì ghi đủ, vd "Lumio Agency LLC")*
- Business type: `[Sole Proprietor / LLC / Corporation — điền đúng loại đã đăng ký]`
- EIN / Tax ID (US): `[BẮT BUỘC — điền mã số thuế; thiếu là rớt]`
- Physical business address: `[Số nhà, đường, thành phố, bang, ZIP — địa chỉ THẬT ở Mỹ, KHÔNG dùng PO Box]`
- Business website: `https://lumiobooking.com`
- Authorized contact: `[Họ tên]` · `lumioagency.com@gmail.com` · `[số điện thoại doanh nghiệp]`
- Business regions of operation: `United States, Canada`

**Messaging use case**
- Use case category: `Mixed` (hoặc `Low Volume Mixed` nếu số lượng thấp) — vì có cả nhắc lịch (transactional) và khuyến mãi (marketing).
- Use case description (dán nguyên văn):
> Lumio Booking (operated by Lumio Agency) is an appointment‑booking and salon‑management platform for nail salons. This toll‑free number sends appointment notifications (confirmations, reminders, and changes) and — only to customers who separately opt in — occasional promotional offers, to customers of salons that use Lumio Booking. Lumio Booking operates and controls the opt‑in mechanism (a public web form at https://lumiobooking.com/sms-optin and a consent step inside the online booking flow) and creates all message content from standardized templates. Consumers provide their mobile number and give explicit consent via an unchecked checkbox they must actively select before any message is sent; consent is stored with a timestamp. Every message identifies the program (Lumio Booking) and includes STOP opt‑out instructions. Consent is never a condition of any purchase.

- Opt‑in type: `Web form / Online sign‑up`
- Opt‑in description (dán nguyên văn):
> Consumers opt in two ways: (1) a public web form at https://lumiobooking.com/sms-optin where they enter their mobile number and actively check a consent box; and (2) during online booking at lumiobooking.com/<salon> on the “Your details & payment” step, where they enter their mobile number for transactional messages and can separately check an unchecked box to also receive promotional texts. At the point of opt‑in we display the consent language, message frequency (up to ~6 messages/month), “Message and data rates may apply,” and STOP/HELP instructions, with links to the Privacy Policy and Terms. Opt‑in is never required to complete a booking. Consent is recorded with a timestamp.

**URLs (đã live, dùng đúng các link này)**
- Opt‑in proof URL: `https://lumiobooking.com/sms-optin`
- Privacy Policy URL: `https://lumiobooking.com/privacy`
- Terms & Conditions URL: `https://lumiobooking.com/terms`
- Help/Support URL: `https://lumiobooking.com/support`

**Sample messages** (dán 2–3 tin này — đã có brand + STOP + rates):
1. `Lumio Booking: Hi Jane, a reminder of your Manicure at Rose Nails on Fri Jul 10 at 2:00 PM. Reply C to confirm or call the salon. Reply STOP to opt out, HELP for help.`
2. `Lumio Booking: Rose Nails — 20% off gel sets this week! Book: lumiobooking.com/rose-nails. Msg & data rates may apply. Reply STOP to opt out.`
3. `Lumio Booking: You’re unsubscribed and will receive no more messages. Reply START to resume.`

**Estimated monthly volume:** `[điền ước lượng, vd 500–2000/tháng]`
**Message content includes opt‑out (STOP):** `Yes` · **HELP reply set up:** `Yes`

---

### Path B — đứng tên MỘT tiệm cụ thể (end‑business)
Giống Path A nhưng phần **Business information** điền **thông tin thật của tiệm** (tên pháp lý tiệm, EIN của tiệm, địa chỉ tiệm, website/booking page của tiệm `https://lumiobooking.com/<slug-tiệm>`, người liên hệ của tiệm). Trong use‑case, đổi câu đầu thành *"[Tên tiệm] uses Lumio Booking to send appointment notifications and, with separate opt‑in, promotions to its own customers…"*. Thông tin Lumio nằm ở **hồ sơ ISV (TrustHub)**, KHÔNG điền vào ô end‑business.

---

## 5. Checklist trước khi bấm "Resubmit"
- [ ] TrustHub Primary Profile (Business Identity = ISV) đã **Approved**.
- [ ] Ô doanh nghiệp điền **end‑business** đúng (Path A: Lumio; Path B: tiệm) — **có EIN + địa chỉ thật, không PO Box**.
- [ ] Use‑case + opt‑in description dán như trên.
- [ ] 3 link (opt‑in / privacy / terms) mở được và đúng.
- [ ] Sample messages có tên chương trình + "Reply STOP" + "Msg & data rates may apply".
- [ ] **Nộp lại trong 7 ngày** (Edit & resubmit) để vào hàng ưu tiên.

## 6. Nội dung tôi đã sửa/deploy giúp anh (phần website Twilio kiểm tra)
- `lumiobooking.com/privacy` — có sẵn điều khoản bắt buộc: dữ liệu opt‑in **không chia sẻ cho bên thứ ba**. ✔
- `lumiobooking.com/terms` — Điều khoản SMS đầy đủ (opt‑in, tần suất, phí, STOP/HELP). ✔
- `lumiobooking.com/sms-optin` — form opt‑in chuẩn (checkbox **mặc định chưa tick**, mô tả loại tin, tần suất, phí, STOP/HELP, link Privacy/Terms) — **vừa bổ sung phần "Sample messages" + tên đơn vị vận hành**. ✔
- Trang chủ + footer link tới Privacy / Terms / Text Alerts / Support (web presence). ✔

*Lưu ý: tôi không phải chuyên gia pháp lý/viễn thông; quyết định cuối là ở đội duyệt Twilio. Anh nên đối chiếu thêm tài liệu Twilio khi điền EIN/địa chỉ.*
