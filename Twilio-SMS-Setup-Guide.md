# Kết nối Twilio vào Lumio Booking — Hướng dẫn gửi SMS

> Số của bạn: **+1 (833) 719-5153** (toll-free, US). Account: My first Twilio account.
> Tôi đã code sẵn **provider Twilio thật** trong app — giờ chỉ cần khai báo khoá + bật là chạy.

---

## ⚠️ Điều quan trọng nhất phải biết trước

Số **toll-free CHƯA được verify thì Twilio CHẶN HẾT mọi tin** (kể cả tin xác nhận lịch, không chỉ marketing) — báo lỗi **Error 30032**.

➡️ Nghĩa là: kết nối app xong (các bước dưới) nhưng **SMS chỉ thật sự gửi được sau khi hồ sơ Toll-Free Verification của bạn được DUYỆT**. Bạn vẫn nên kết nối sẵn ngay bây giờ; khi Twilio duyệt là tự động chạy.

---

## Phần 1 — Lấy khoá từ Twilio Console

1. Vào **console.twilio.com** → trang chủ (Account Dashboard).
2. Mục **Account Info**, copy 2 giá trị:
   - **Account SID** → bắt đầu bằng `AC...`
   - **Auth Token** → bấm "Show", copy (đây là MẬT KHẨU — không gửi cho ai, không chụp công khai).

## Phần 2 — Tạo Messaging Service (KHUYÊN DÙNG)

Dùng Messaging Service thay vì gắn thẳng số, vì nó **tự xử lý STOP/HELP/START** (bắt buộc theo luật) và dễ mở rộng.

1. Console → **Messaging → Services → Create Messaging Service**.
2. Đặt tên: `Lumio Booking`. Use case: **Notify my users**.
3. Bước **Sender Pool → Add Senders → Phone Number** → chọn số **(833) 719-5153** → Add.
4. Bước **Opt-Out Management** → bật **Advanced Opt-Out** (Twilio tự trả lời STOP/HELP). Câu xác nhận STOP dán:
   ```
   You have been unsubscribed and will receive no further messages from this sender. Reply START to resubscribe.
   ```
5. Lưu lại. Vào lại Service vừa tạo, copy **Messaging Service SID** → bắt đầu bằng `MG...`

> Nếu không muốn dùng Messaging Service, có thể bỏ qua Phần 2 và dùng thẳng số `+18337195153` ở Phần 3 — nhưng khi đó bạn phải tự lo STOP/HELP, nên không khuyến khích.

## Phần 3 — Khai báo khoá vào Render (env vars)

1. Vào **dashboard.render.com** → chọn service **API** (lumio-api...).
2. Tab **Environment** → **Add Environment Variable**, thêm:

   | Key | Value |
   |---|---|
   | `TWILIO_ACCOUNT_SID` | `AC...` (Phần 1) |
   | `TWILIO_AUTH_TOKEN` | (Auth Token ở Phần 1) |
   | `TWILIO_MESSAGING_SERVICE_SID` | `MG...` (Phần 2) |

   *(Nếu KHÔNG tạo Messaging Service: bỏ dòng `MG...`, thay bằng `TWILIO_FROM_NUMBER` = `+18337195153`.)*

3. ⚠️ **QUAN TRỌNG:** trong danh sách env var, tìm biến **`SMS_PROVIDER`** — nếu đang để giá trị `mock` thì **XÓA biến đó đi** (hoặc để trống). Nếu còn `mock`, app sẽ bị ép dùng SMS giả lập và **không gửi Twilio**.
4. Bấm **Save Changes** → Render tự build lại. App sẽ **tự nhận diện và bật Twilio** ngay khi thấy đủ `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + (MG SID hoặc số).

## Phần 4 — Deploy code mới

Code provider Twilio tôi vừa thêm cần được đẩy lên: chạy **`deploy.bat`** một lần. (Nếu bạn đã set env ở Phần 3 trước, sau khi deploy xong là đủ cả code + khoá.)

## Phần 5 — Bật SMS trong app

Vào **Salon Admin → Settings**:

- Tab **Notifications**: bật **"SMS to customer on booking"** (gửi tin xác nhận khi khách đặt).
- Tab **Reminders**: bật **"Send automatic reminders"** + tick **"By SMS"** (nhắc lịch trước giờ hẹn).

> Mỗi tiệm (tenant) bật riêng. Nội dung tin đã có sẵn tên tiệm + "Reply STOP to opt out".

## Phần 6 — Kiểm tra

1. Sau khi toll-free đã **verified** + làm xong Phần 1–5:
2. Vào trang booking, đặt 1 lịch test bằng **số điện thoại của bạn**.
3. Bạn sẽ nhận tin xác nhận. Kiểm tra log: Twilio Console → **Monitor → Logs → Messaging**.
4. Nếu thấy **Error 30032** = số chưa verified xong (đợi duyệt). Lỗi **21608/trial** = tài khoản trial chỉ gửi được tới số đã verify trong Twilio.

---

## Phần 7 — SMS Marketing: hiện trạng & bước tiếp

**App hiện ĐÃ gửi (transactional, tự động):**
- Xác nhận đặt lịch, nhắc lịch (1 chạm confirm/cancel), báo có chỗ trống (waitlist), hủy/đổi lịch, biên nhận thanh toán.

**SMS Marketing hàng loạt (gửi khuyến mãi cho nhiều khách) — CHƯA có sẵn.** Trong app có mẫu tin "win-back/cảm ơn", "sinh nhật" nhưng chưa có công cụ:
- Chọn nhóm khách (vd: khách 60 ngày chưa quay lại),
- Soạn nội dung khuyến mãi,
- Gửi đồng loạt **chỉ tới khách đã đồng ý nhận marketing** (tôi đã lưu sẵn trường `smsConsent` lúc họ tick ô ở booking form),
- Tự chèn STOP, tôn trọng người đã opt-out, giới hạn tốc độ gửi.

👉 Đây là một tính năng riêng cần build. Tôi đã chuẩn bị sẵn nền tảng đồng ý (consent) nên làm sẽ đúng luật. **Bạn muốn tôi build "Trình gửi SMS Marketing" này không?** Nếu có, tôi sẽ làm: trang chọn khách + soạn tin + gửi hàng loạt + thống kê, chỉ gửi cho khách đã opt-in.

---

## Tóm tắt checklist
- [ ] Toll-Free Verification được Twilio **duyệt** (điều kiện tiên quyết để gửi)
- [ ] Lấy Account SID + Auth Token
- [ ] Tạo Messaging Service → lấy MG SID (+ bật Advanced Opt-Out)
- [ ] Khai báo 3 env var vào Render → Save
- [ ] Chạy `deploy.bat`
- [ ] Bật SMS ở tab Notifications + Reminders
- [ ] Test bằng số của mình, xem Message Logs
