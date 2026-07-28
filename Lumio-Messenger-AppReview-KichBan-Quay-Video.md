# Lumio Messenger — Khắc phục App Review Meta & Kịch bản quay video

_Cập nhật: 28/07/2026 · Áp dụng cho 2 quyền bị từ chối: `pages_manage_metadata` và `pages_messaging`_

---

## 1. Vì sao bị từ chối (đọc kỹ phần này trước)

Meta **KHÔNG** nói tính năng của anh sai. Cả hai lần từ chối đều ghi:
> _"your apps' use case is allowed, however, the submitted screencast fails to demonstrate the end-to-end experience…"_

Nghĩa là: **use case được chấp nhận — chỉ có VIDEO chưa quay đủ**. Reviewer phải **tự mắt nhìn thấy** toàn bộ hành trình trong video, không được suy đoán.

### `pages_manage_metadata` — reviewer yêu cầu thấy:
1. Chỗ ứng dụng **subscribe Page vào sự kiện** (webhook), **hoặc** cập nhật cài đặt Page.
2. **Một sự kiện webhook thật đi vào ứng dụng** (ví dụ: tin nhắn/bình luận mới hiện lên trong app), **gắn với đúng Page** đã hiển thị lúc setup.

### `pages_messaging` — reviewer yêu cầu thấy:
1. **Chọn tài sản** (Page — tên + ID phải hiện rõ trên màn hình).
2. **Một hành động gửi tin THẬT từ giao diện ứng dụng** ("a live send action from your app").
3. **Tin nhắn đó xuất hiện trong Messenger** (native client: app Messenger điện thoại hoặc messenger.com).

### Nguyên nhân gốc (đã khắc phục)
Video cũ chỉ cho thấy trạng thái `Connected` + bot bật. Reviewer **không thấy**: Page nào đang dùng, Page đã subscribe webhook chưa, tin khách đi vào đâu, và **không có nút để người dùng tự bấm gửi tin từ app**. Bot tự động trả lời không tính là "live send action from your app" theo cách reviewer nhìn.

---

## 2. Đã bổ sung gì trong hệ thống (PHẢI deploy trước khi quay)

Trang **Messenger** (Salon admin) giờ có đủ 4 khối bằng chứng để quay:

| Khối | Nội dung hiển thị | Phục vụ quyền |
|---|---|---|
| **Connection details** | Facebook Page (tên) · Page ID · Status: Connected · **Webhook subscription: Active** · Subscribed events: `messages`, `messaging_postbacks`, `message_reactions` · Last verified | `pages_manage_metadata` |
| **Send a test message** | Chọn hội thoại (Recipient) → soạn tin → nút **Send message** → **Message sent ✓** | `pages_messaging` |
| **Messenger activity** | Dòng `Page: Lumio Booking` + bảng log: Time (ngày+giờ) · Direction (Incoming/Outgoing) · User (**tên khách**) · Message · Status (Received / Sent / Failed) | Cả hai (event đi vào + tin gửi ra) |
| **Webhook (manual — advanced)** | Thu gọn mặc định; kèm ghi chú "app tự subscribe khi Connect" | Tránh gây hiểu nhầm |

**Kỹ thuật:** khối "Connection details" đọc **trực tiếp từ Graph API** `GET /{page-id}/subscribed_apps` → chứng minh Page thật sự đã subscribe app (không phải chữ tĩnh). Nút Send gọi `POST /me/messages` thật và ghi vào Activity.

> ⚠️ **Bắt buộc:** Deploy **`lumio-api`** và **`lumio-web`** (Render → Manual Deploy → Deploy latest commit) rồi hard-refresh, TRƯỚC khi quay. Nếu chưa deploy, 4 khối này chưa xuất hiện.

Đồng thời đã **bỏ dòng gây hiểu nhầm** cũ ("works after Meta approves messaging permission") — thay bằng: _"Messaging is enabled for Facebook Pages connected by an authorized Page administrator."_

---

## 2b. RESET VỀ TRẠNG THÁI SẠCH (làm ngay trước khi quay)

Mục tiêu: trang Messenger trông như salon mới tinh — không dữ liệu test cũ, không tiếng Việt lẫn lộn.

1. Deploy bản mới nhất (`lumio-api` + `lumio-web`) → hard refresh.
2. Chuyển giao diện sang **EN**.
3. Trang Messenger → khối **Messenger activity** → tick **Meta Review Mode** → bấm **Clear ALL conversations** → xác nhận. (Xóa TOÀN BỘ hội thoại + activity của salon này; kết nối Facebook, webhook, cấu hình bot GIỮ NGUYÊN.)
4. Bấm **Disconnect** ở khối Connect (để video bắt đầu từ "Not connected"). Sau khi disconnect, các khối Send test / Activity **tự ẩn** — trang chỉ còn nút Connect: đúng cảnh mở đầu.
5. Đóng tab thừa, tắt notification máy tính, mở sẵn Messenger trên điện thoại của tài khoản KHÁCH.
6. Bắt đầu quay theo kịch bản mục 4. Khi Connect xong, các khối bằng chứng tự xuất hiện — chi tiết này quay lên rất thuyết phục.
7. Sau khi Connect, bật lại **Meta Review Mode** + bấm **Generate new review ID** → dùng mã đó trong MỌI tin nhắn của video.

---

## 2c. BẢNG ĐỐI CHIẾU — từng yêu cầu Meta đã từ chối ↔ tính năng hiện có

| # | Meta yêu cầu (nguyên văn rejection) | Đã có trong hệ thống | Quay ở cảnh |
|---|---|---|---|
| 1 | The complete Meta login flow | Nút Connect with Facebook → OAuth thật | A1–A2 |
| 2 | A user granting app access to the permission | Màn chọn Page + 4 quyền hiển thị | A3 |
| 3 | (metadata) where your app subscribes to Page events | Tự gọi `POST /{page-id}/subscribed_apps` khi connect + thông báo 2 dòng "connected + subscribed" + khối Connection details đọc live `GET /subscribed_apps` → Webhook: Active + events | A4, B1 |
| 4 | (metadata) a sample webhook event arriving in your app, tied to the same Page | Messenger Activity: dòng `Page: <tên>`, Incoming + tên khách + nội dung + Received + timestamp giây; tự cập nhật (polling 8s) + nút Refresh activity | B2–B3 |
| 5 | (messaging) asset selection (Page visible) | Connection details (Page name + ID) + "Sending as: <Page>" + Recipient (tên khách, Last message) | C1 |
| 6 | (messaging) a live send action from your app | Nút Send message → "Sending…" → gọi thật `POST /me/messages` → "Message sent successfully · Status: Sent · giờ" + dòng Outgoing/Sent highlight; lỗi → Failed, giữ nội dung | C2 |
| 7 | (messaging) the delivered message in the native client | Quay app Messenger điện thoại nhận đúng câu | C3 |
| 8 | Use English as the app UI language, captions & tooltips | Toggle EN + caption tiếng Anh từng cảnh trong kịch bản | Toàn video |
| 9 | Server-to-server / system user token? | KHÔNG — Facebook Login frontend, luồng hiển thị đầy đủ (ghi rõ trong Notes) | Notes |

Hỗ trợ quay sạch: **Meta Review Mode** (chỉ hiện tin `META-REVIEW-`), **Review Test ID** (Generate/Copy), **Clear review test data**, **Clear ALL conversations**.

---

## 3. Chuẩn bị trước khi quay (checklist)

- [ ] **Deploy** `lumio-api` + `lumio-web`, hard-refresh trang Messenger.
- [ ] Bấm **Reconnect Facebook** MỘT lần sau deploy — để hệ thống lưu **tên Page** (Lumio Booking) và tên khách vào kết nối (kết nối cũ tạo trước bản cập nhật nên chưa có tên).
- [ ] **Đổi giao diện app sang tiếng Anh** (English) — Meta bắt buộc UI tiếng Anh trong video. Dùng nút chuyển ngôn ngữ (VI → EN).
- [ ] **1 Page test** (ví dụ *Lumio Booking*) đã bấm **Connect with Facebook** → hiện Status: Connected + Webhook: Active.
- [ ] **1 tài khoản Facebook khác** đóng vai KHÁCH (test user), dùng **ứng dụng Messenger trên ĐIỆN THOẠI** (native client — reviewer yêu cầu; Messenger trên trình duyệt là phương án dự phòng, yếu hơn).
- [ ] Cách đưa màn điện thoại vào video: **phản chiếu màn hình** lên máy tính (iPhone: QuickTime/AirPlay · Android: scrcpy) hoặc **quay trực tiếp điện thoại** rõ nét trong cùng video.
- [ ] Phần mềm quay màn hình: **Loom / OBS / QuickTime** (Mac) — quay **1080p**, có thể quay kèm màn điện thoại (AirPlay/scrcpy) hoặc quay điện thoại bằng camera.
- [ ] Chuẩn bị **caption tiếng Anh** (chữ overlay). Có thể dùng CapCut, Descript, hoặc thêm text ngay khi quay bằng cách hiện chú thích trên màn.
- [ ] Thêm tài khoản KHÁCH test vào **Meta App → App Roles → Testers** (để app đọc được TÊN khách khi chưa duyệt quyền; không có role sẽ hiện PSID).
- [ ] Đăng nhập **admin Lumio**, mở trang **Messenger**, sẵn sàng.

> 💡 Reviewer đọc caption tiếng Anh. Nếu không tiện làm caption, **thuyết minh bằng giọng tiếng Anh** cũng được, nhưng **caption chữ an toàn hơn** vì rõ ràng và không phụ thuộc âm thanh.

---

## 4. Kịch bản MỘT video (bao trùm cả 2 quyền)

Quay **một video liền mạch 2–4 phút**, chia 3 phần. Mỗi cảnh có **[Việc cần làm]** (cho anh) và **[Caption]** (chữ tiếng Anh hiện trên màn hình).

### PHẦN A — Đăng nhập & cấp quyền (chung cho cả 2 quyền)

**Cảnh A1 — Mở trang & bắt đầu kết nối**
- [Việc cần làm] Ở trang Messenger (đang là English), Page chưa kết nối (nếu đã kết nối thì bấm **Disconnect** trước để quay lại từ đầu). Bấm **Connect with Facebook**.
- [Caption] `Lumio Booking — salon admin connects their Facebook Page`

**Cảnh A2 — Facebook Login flow**
- [Việc cần làm] Màn đăng nhập Facebook hiện ra → đăng nhập tài khoản quản trị Page.
- [Caption] `Step 1 — Facebook Login`

**Cảnh A3 — Chọn Page (asset selection) & cấp quyền**
- [Việc cần làm] Ở màn "What do you want to allow…", **chọn đúng Page** (Lumio Booking). Quay chậm để thấy rõ **tên Page + danh sách quyền**: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `business_management`. Bấm **Continue / Save**.
- [Caption] `Step 2 — Select the Page and grant permissions (pages_show_list, pages_messaging, pages_manage_metadata, business_management)`

**Cảnh A4 — Quay lại app, xác nhận kết nối**
- [Việc cần làm] Trở về trang Messenger. Dừng ở khối **Connection details**: thấy **Facebook Page: Lumio Booking**, **Page ID: …**, **Status: Connected**.
- [Caption] `Connected — Page name and Page ID are shown in the app`

---

### PHẦN B — `pages_manage_metadata` (subscribe webhook + sự kiện đi vào)

**Cảnh B1 — Bằng chứng subscribe Page vào webhook**
- [Việc cần làm] Vẫn ở khối **Connection details**, chỉ (zoom/hover) vào dòng **Webhook subscription: Active** và **Subscribed events: messages · messaging_postbacks · message_reactions**, **Last verified: …**. Giải thích ngắn: khi Connect, app tự gọi `POST /{page-id}/subscribed_apps`.
- [Caption] `The app subscribed this Page to webhook events via POST /{page-id}/subscribed_apps. Status is read live from GET /{page-id}/subscribed_apps.`

**Cảnh B2 — Tạo một sự kiện webhook thật**
- [Việc cần làm] Chuyển sang **ứng dụng Messenger trên điện thoại của tài khoản KHÁCH** (ưu tiên native app). Nhắn cho Page (Lumio Booking) một tin, ví dụ: `META REVIEW INBOUND — hello Lumio`. Quay rõ tin này gửi tới **đúng Page** đã setup.
- [Caption] `A test user sends a message to the same Page from Messenger — this triggers a "messages" webhook event`

**Cảnh B3 — Sự kiện đi vào ứng dụng**
- [Việc cần làm] Quay lại trang Messenger, refresh. Ở khối **Messenger activity**, dòng mới xuất hiện: **Incoming · <tên khách test> · "META REVIEW INBOUND…" · Received** (kèm dòng `Page: Lumio Booking` ngay trên bảng). (Bot cũng có thể tự trả lời → thêm dòng **Outgoing · Sent**.)
- [Caption] `The webhook event arrives in the app and appears in Messenger Activity (Incoming / Received), tied to the same Page`

> ✅ Phần B đã chứng minh đủ 2 ý reviewer cần: (1) app subscribe Page vào sự kiện, (2) sự kiện webhook thật đi vào app, gắn đúng Page.

---

### PHẦN C — `pages_messaging` (gửi tin THẬT từ app + hiện trong Messenger)

**Cảnh C1 — Chọn tài sản (Page/hội thoại) trong app**
- [Việc cần làm] Cuộn tới khối **Send a test message**. Khối này hiện **Sending as: Lumio Booking**. Ở **Recipient**, chọn hội thoại của khách test vừa nhắn (hiện tên khách). Page đang dùng vẫn hiển thị ở khối Connection phía trên.
- [Caption] `Step 1 — Select the Page conversation (asset) to reply to`

**Cảnh C2 — Gửi tin THẬT từ giao diện app**
- [Việc cần làm] Gõ vào ô **Message** một câu dễ nhận: `Hi! This is Lumio confirming your appointment — reply CONFIRM.` Bấm **Send message**. Chờ hiện **Message sent ✓ · <giờ gửi>**.
- [Caption] `Step 2 — Live send action from the app UI: clicking "Send message" calls POST /me/messages`

**Cảnh C3 — Tin xuất hiện trong Messenger (native client)**
- [Việc cần làm] Chuyển sang **ứng dụng Messenger trên điện thoại của khách test** (native client — bắt buộc cho cảnh này). Quay rõ **đúng câu vừa gửi** xuất hiện trong cuộc trò chuyện với Page, gửi từ **Lumio Booking**.
- [Caption] `Step 3 — The same message is delivered in the native Messenger client, sent from the Page`

**Cảnh C4 — Đối chiếu trong Activity**
- [Việc cần làm] Về app, khối **Messenger activity** có dòng **Outgoing · Sent** đúng nội dung vừa gửi (kèm tên người nhận + thời gian).
- [Caption] `The outgoing message is logged in the app as Sent`

> ✅ Phần C chứng minh đủ 3 ý: (1) chọn Page/hội thoại, (2) live send từ app UI, (3) tin hiện trong Messenger native.

**Kết video:** dừng 1–2 giây ở khối Messenger activity thấy cả **Incoming (Received)** và **Outgoing (Sent)** cạnh nhau.

---

## 5. Ghi chú gửi Meta (dán vào ô "Notes" mỗi quyền — tiếng Anh)

### Cho `pages_manage_metadata`
```
Lumio Booking is a SaaS appointment-booking assistant for nail salons. A salon
admin connects their own Facebook Page via Facebook Login (shown at 0:00–0:30).

pages_manage_metadata is used to subscribe the connected Page to our webhook so
the salon receives customer messages. On connect, the app calls
POST /{page-id}/subscribed_apps with fields: messages, messaging_postbacks,
message_reactions.

In the screencast:
- 0:30 "Connection details" shows the Page name + Page ID and
  "Webhook subscription: Active" with the subscribed events. This status is read
  live from GET /{page-id}/subscribed_apps.
- 0:45 a test user sends a message to the SAME Page from Messenger.
- 0:55 the webhook event arrives and appears in "Messenger Activity"
  (Incoming / Received), tied to the same Page shown during setup.

This is a standard Facebook Login app; the login and permission-grant flow is
fully visible in the video.
```

### Cho `pages_messaging`
```
pages_messaging is used to reply to customers who messaged the salon's Facebook
Page, within the standard 24-hour messaging window.

In the screencast:
- 1:05 in "Send a test message" the admin selects the Page conversation (asset).
- 1:15 the admin types a message and clicks "Send message" — a live send action
  from our app UI that calls POST /me/messages (messaging_type: RESPONSE).
- 1:25 the SAME message is shown delivered in the native Messenger client,
  sent from the Page.
- 1:35 the outgoing message is logged in the app as "Sent".

The Page name and Page ID are visible in "Connection details" throughout.
```

> Nếu Meta hỏi app có phải server-to-server / dùng system user token không: **KHÔNG** — Lumio dùng **Facebook Login (frontend OAuth)**, luồng đăng nhập & cấp quyền hiển thị đầy đủ trong video. (Không cần khai mục #5 trong hướng dẫn của họ.)

---

## 6. Checklist trước khi bấm Submit

- [ ] App UI **tiếng Anh** suốt video.
- [ ] Có **Facebook Login flow** (đăng nhập + màn cấp quyền liệt kê 4 scope).
- [ ] **Tên Page + Page ID** hiển thị rõ ít nhất 1 lần.
- [ ] **Webhook subscription: Active** + subscribed events hiển thị rõ.
- [ ] **Tin khách gửi vào** hiện ở Messenger Activity (Incoming/Received).
- [ ] **Bấm nút Send message** trong app → **Message sent ✓**.
- [ ] **Cùng câu đó** xuất hiện trong **Messenger thật** (điện thoại/messenger.com).
- [ ] Caption tiếng Anh cho từng bước, giải thích nút bấm.
- [ ] Video rõ nét (1080p), không che thông tin Page.
- [ ] Dán **Notes** tiếng Anh (mục 5) cho từng quyền.
- [ ] Bấm **Request again** → nộp lại cả `pages_manage_metadata` và `pages_messaging`.

---

## 7. Lỗi thường gặp khiến bị từ chối lần nữa (tránh)

1. **UI tiếng Việt trong video** → luôn đổi sang English.
2. **Không thấy nút gửi** → phải quay rõ động tác bấm **Send message** (không chỉ bot tự trả lời).
3. **Không cắt sang Messenger thật** → thiếu bằng chứng "delivered in native client".
4. **Page trong video khác Page lúc setup** → phải cùng một Page xuyên suốt.
5. **Quá 24 giờ** kể từ khi khách nhắn → cửa sổ nhắn tin đóng, Send sẽ báo lỗi. Hãy để khách test nhắn **ngay trước khi** quay phần gửi.
6. **Video quá nhanh / mờ** → quay chậm, zoom vào chỗ quan trọng.

---

_Mọi thay đổi hệ thống đã sẵn trong code (`apps/api` + `apps/web`). Chỉ cần deploy rồi quay theo kịch bản trên._
