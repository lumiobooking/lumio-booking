# Kịch bản quay video cho Meta App Review — Lumio Booking

App ID `1707103183956838` · 4 quyền cần quay 4 video riêng.

---

## Trước khi bấm ghi hình — 6 việc bắt buộc

Đây là chỗ hầu hết hồ sơ bị từ chối, không phải ở chất lượng video.

**1. Deploy xong bản mới.** Tab "Lịch đăng bài" phải chạy được thật. Reviewer nhìn thấy màn hình trống là hồ sơ hỏng.

**2. Gọi API thật 1 lần cho mỗi quyền đăng bài.** Vào Lịch đăng bài → tạo 1 bài → **Đăng ngay** cho Facebook, rồi 1 bài nữa cho Instagram. Meta đang hiện "0 of 1 API call". Sau khi đăng, **đợi tới 24 tiếng** con số mới nhảy thành 1/1. Chưa đủ thì nút nộp không sáng.

**3. App phải ở chế độ Live.** Đang Live rồi — đừng chuyển sang Development trước khi duyệt xong.

**4. Chuẩn bị 1 tài khoản thử cho reviewer.** Tạo một tài khoản Salon Admin riêng (ví dụ `review@lumio...`) trên một tiệm demo có sẵn vài lịch hẹn và 2–3 hội thoại Messenger. Email + mật khẩu tài khoản này anh tự điền vào ô **Reviewer instructions**, không đưa cho ai khác, kể cả tôi.

**5. Che sạch thông tin nhạy cảm.** Trước khi quay, đóng hết: DevTools, tab Render, tab Meta Developers (chỗ có App Secret), Postman, terminal. Nếu URL có token thì đừng để thanh địa chỉ trong khung hình.

**6. Ngôn ngữ.** Reviewer đọc tiếng Anh. Chuyển app sang **English** bằng nút đổi ngôn ngữ trước khi quay. Nếu để tiếng Việt thì phải chèn phụ đề tiếng Anh — thêm việc, dễ sai. Cứ đổi sang English cho gọn.

**Cách quay:** phần mềm nào cũng được (Xbox Game Bar `Win+G`, OBS, Loom). Xuất **MP4, 1080p**. Mỗi video **2–4 phút**. Quay liền mạch một mạch, **không cắt ghép** — reviewer nghi ngờ video bị cắt là loại. Không cần tiếng nói; dùng chữ chèn (caption) tiếng Anh ở mỗi cảnh.

---

## PHẦN MỞ ĐẦU — quay 1 lần, dùng chung cho cả 4 video

Cả 4 video đều **phải** bắt đầu bằng đoạn này. Meta muốn thấy người dùng **cấp quyền** rồi mới thấy quyền được dùng. Thiếu đoạn này là lý do từ chối phổ biến nhất.

| # | Việc làm trên màn hình | Chữ chèn (tiếng Anh) |
|---|---|---|
| 1 | Mở trình duyệt ở trang đăng nhập Lumio, **chưa đăng nhập** | `Lumio Booking — appointment software for nail salons` |
| 2 | Nhập email + mật khẩu tài khoản thử → đăng nhập | `A salon owner signs in to her own account` |
| 3 | Vào **Settings → Messenger** | `The salon connects its OWN Facebook Page` |
| 4 | Bấm **Connect Facebook Page** | |
| 5 | **Dừng 3–4 giây ở hộp thoại Facebook Login** — thấy rõ danh sách quyền đang xin | `The salon grants access to its own Page` |
| 6 | Chọn Page → **Continue** → về app, thấy Page đã kết nối | `Page connected` |

> Bước 5 quan trọng nhất cả video. Đừng bấm nhanh qua.

---

## VIDEO 1 — Business Asset User Profile Access *(cái cho ra avatar thật)*

**Cần chuẩn bị:** ít nhất 3 hội thoại Messenger/Instagram thật trong Inbox, trong đó có **2 khách trùng tên hoặc tên gần giống** (ví dụ 2 người tên "Tien"). Đây là lập luận mạnh nhất của hồ sơ này.

| # | Việc làm | Chữ chèn |
|---|---|---|
| 1 | *(Phần mở đầu)* | |
| 2 | Mở **Inbox** | `The salon answers its customers here, not in the Meta apps` |
| 3 | **Zoom / dừng 3 giây** vào danh sách hội thoại — thấy rõ **ảnh đại diện + tên thật** từng người | `Name and profile picture, read with Business Asset User Profile Access` |
| 4 | Chỉ vào 2 khách trùng tên | `Two different customers with the same first name` |
| 5 | Mở hội thoại người thứ nhất → trỏ sang panel bên phải: lịch hẹn, số lần đến, thợ quen | `The staff member confirms WHICH customer before touching her booking` |
| 6 | Mở hội thoại người thứ hai → panel đổi sang lịch hẹn khác | `Different person, different appointment` |
| 7 | Bấm sửa/đổi giờ lịch hẹn của đúng người đó | `Without the name and photo, both threads would read "Customer 326369"` |

**Điểm phải thấy được:** ảnh đại diện thật + tên thật, và việc tên đó dùng để **xác nhận đúng khách trước khi sửa lịch**. Đừng chỉ lướt qua Inbox rồi hết.

---

## VIDEO 2 — Human Agent

**Cần chuẩn bị:** một hội thoại có tin nhắn cuối của **khách** cách đây **hơn 24 giờ**. Nếu chưa có, nhắn thử từ một tài khoản Facebook khác vào Page rồi để qua một ngày.

| # | Việc làm | Chữ chèn |
|---|---|---|
| 1 | *(Phần mở đầu)* | |
| 2 | Mở Inbox → chọn hội thoại cũ đó | `The customer asked to reschedule` |
| 3 | **Dừng 3 giây ở dấu thời gian tin nhắn của khách** — phải đọc được là hơn 24h trước | `She wrote more than 24 hours ago — the salon was closed` |
| 4 | Bấm **Take over** (nhân viên tiếp quản) | `A real staff member takes over from the bot` |
| 5 | **Gõ tay** câu trả lời, chậm rãi, thấy rõ từng chữ. Nội dung phải là trả lời đúng câu khách hỏi — ví dụ: `Hi Tien, I moved your appointment to Saturday 2 PM. See you then!` | `A human types the reply — this is what the human_agent tag is for` |
| 6 | Bấm **Send** → tin nhắn hiện trong luồng | `Delivered outside the 24-hour window` |
| 7 | Đổi giờ lịch hẹn trên calendar cho khớp | `Her booking is updated to match` |

**Tuyệt đối không:** đừng gõ nội dung khuyến mãi, giảm giá, mời quay lại. Chỉ trả lời đúng việc khách hỏi. Meta loại thẳng nếu thấy human_agent dùng để quảng cáo.

---

## VIDEO 3 — pages_manage_posts *(đăng Facebook theo lịch)*

**Cần chuẩn bị:** một bài đã có nội dung sẵn trong tab Hôm nay.

| # | Việc làm | Chữ chèn |
|---|---|---|
| 1 | *(Phần mở đầu)* | |
| 2 | Mở tab **Content → Today**, thấy các bài hệ thống soạn từ số liệu của tiệm | `Lumio drafts posts from the salon's own data` |
| 3 | Bấm **Schedule it** trên một bài | |
| 4 | **Sửa vài chữ trong caption bằng tay** — cho thấy con người duyệt nội dung | `The owner reviews and edits before anything is published` |
| 5 | Chọn **Facebook** | |
| 6 | Chọn ngày giờ đăng | `She picks the day and time` |
| 7 | Bấm **Schedule it** → bài hiện trong hàng đợi với trạng thái *Scheduled* | `The post joins the queue` |
| 8 | Bấm **Post now** trên chính bài đó | `Publishing to the salon's own Page` |
| 9 | Đợi thành **Posted**, hiện link **View on Facebook** | |
| 10 | **Bấm vào link** → mở Fanpage thật, thấy bài vừa đăng | `Live on the salon's Page` |
| 11 | Quay lại app, bấm **Cancel** một bài khác đang chờ | `The salon can cancel anything in the queue` |

**Bước 10 là bước ăn tiền.** Reviewer phải thấy bài thật trên Facebook, không chỉ thấy chữ "Posted" trong app.

---

## VIDEO 4 — instagram_content_publish

**Cần chuẩn bị:** Page đã liên kết tài khoản Instagram chuyên nghiệp, và **một link ảnh https công khai** (ảnh thật của tiệm — up lên đâu đó mở được từ internet; link localhost sẽ lỗi).

| # | Việc làm | Chữ chèn |
|---|---|---|
| 1 | *(Phần mở đầu — nhớ để thấy Instagram đã liên kết)* | `The salon's Instagram professional account is linked to its Page` |
| 2 | Content → Today → **Schedule it** | |
| 3 | Sửa caption bằng tay | `The owner writes and approves the caption` |
| 4 | Chọn **Instagram** | |
| 5 | Dán link ảnh vào ô Image URL | `The salon's own photo of its own work` |
| 6 | Chọn ngày giờ → **Schedule it** | |
| 7 | Bấm **Post now** → trạng thái **Posted** | |
| 8 | Bấm **View on Instagram** → mở tài khoản IG thật, thấy bài | `Live on the salon's own Instagram account` |

**Quay thêm 15 giây nếu tiện:** chọn Instagram mà **không** dán link ảnh → hệ thống báo *"Instagram bắt buộc phải có ảnh hoặc video"*. Chú thích: `The app enforces Instagram's own rules before anything is queued`. Cho reviewer thấy mình hiểu và tôn trọng giới hạn của API — điểm cộng thật.

---

## Sau khi có 4 video

**1. Upload.** Mỗi video vào đúng ô của quyền đó ở *Allowed usage → Requests → Get started*. Nếu báo file quá nặng, xuất lại ở 720p.

**2. Tick 4 ô cam kết** *"If approved, I agree that any data I receive through … will be used in accordance with the allowed usage."* — mỗi quyền một ô.

**3. Sang bước Renewal, tick 8 ô** *"I certify that any use of … is within the allowed usage"* cho các quyền đang gia hạn.

**4. Data handling** — trả lời theo thực tế Lumio: dữ liệu lưu trên Render (US), mã hoá khi truyền, mỗi tiệm cách ly bằng `tenant_id`, xoá khi tiệm ngắt kết nối hoặc xoá tài khoản. Chỗ nào không chắc về mặt pháp lý thì hỏi luật sư, đừng đoán — Meta ghi rõ trả lời mơ hồ có thể mất quyền truy cập.

**5. Reviewer instructions** — dán đoạn này rồi điền tài khoản thử vào:

```
Lumio Booking is appointment-booking and marketing software for nail salons
in the United States. Each salon connects its OWN Facebook Page and Instagram
professional account.

Test account
  URL:      [đường dẫn app]
  Email:    [email tài khoản thử]
  Password: [mật khẩu]

To see each permission in use:

Business Asset User Profile Access
  1. Sign in and open Inbox.
  2. The customer name and profile picture shown beside each conversation come
     from this feature. Two customers share a first name; staff use the name
     and photo to confirm which one before editing her appointment.

Human Agent
  1. Inbox, open the conversation last written to more than 24 hours ago.
  2. Click "Take over", type a reply and send it. Only messages typed by a
     human staff member carry the human_agent tag. Automated confirmations and
     reminders are sent separately and are never tagged.

pages_manage_posts
  1. Open Content, then the Today tab.
  2. Press "Schedule it" on any drafted post, edit the text, choose Facebook,
     pick a time, then press "Schedule it".
  3. Press "Post now" on the queued item. When it reads Posted, the
     "View on Facebook" link opens the live post on the salon's own Page.

instagram_content_publish
  1. Same flow, choose Instagram and paste a public https image URL.
  2. Instagram cannot accept a text-only post, so the app refuses to queue one
     without an image. "View on Instagram" opens the published post.

Nothing is published without the salon owner approving it first, and the salon
can cancel any queued post or disconnect its Page at any time.
```

**6. Submit for review.**

---

## Bốn lý do bị từ chối hay gặp nhất — tránh đúng bốn cái này

1. **Video không có đoạn đăng nhập + màn hình cấp quyền Facebook.** Đây là số một.
2. **Không thấy quyền được dùng thật** — chỉ lướt qua giao diện, hoặc quay slide/bản vẽ thay vì app chạy thật.
3. **Video tiếng Việt không phụ đề.**
4. **Reviewer đăng nhập không được** — sai mật khẩu, tài khoản trống rỗng không có dữ liệu để xem, hoặc app đang ở Development mode.

Nếu bị từ chối, Meta ghi lý do ở *App Review → Go to submission feedback*. Chụp lại phần đó gửi tôi, sửa rồi nộp lại được ngay, không bị phạt gì.
