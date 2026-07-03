# Meta App Review Kit — Lumio Booking (Messenger + Instagram bot)

Bộ hồ sơ đầy đủ để đưa app từ **Development → Live**, cho **mọi khách hàng thật** dùng được bot trả lời tự động. Duyệt **1 lần cho cả platform** — sau đó mọi salon connect Page đều dùng được.

> Phần chữ **in khung "PASTE"** là tiếng Anh, copy dán thẳng vào form của Meta.

---

## 0. Thông tin app (điền sẵn)

| Mục | Giá trị |
|---|---|
| App name | **Lumio Booking** |
| App ID | **1707103183956838** |
| Web (frontend) | https://lumiobooking.com |
| API (backend) | https://lumio-api-uqm6.onrender.com |
| Privacy Policy URL | https://lumiobooking.com/privacy |
| Terms of Service URL | https://lumiobooking.com/terms |
| Data Deletion Instructions URL | https://lumiobooking.com/data-deletion |
| Data Deletion Callback URL | https://lumio-api-uqm6.onrender.com/api/messenger/data-deletion |
| Webhook Callback URL | https://lumio-api-uqm6.onrender.com/api/messenger/webhook |
| OAuth Redirect URI | https://lumio-api-uqm6.onrender.com/api/messenger/oauth/callback |
| Verify Token | lumio-verify |

**Thời gian dự kiến:** Business Verification 1–3 ngày; App Review 3–10 ngày. Cần giấy tờ doanh nghiệp + 1 video demo.

---

## 1. Xác minh doanh nghiệp (Business Verification) — BẮT BUỘC

Cần để được "advanced access" (nhắn cho khách không có vai trò trên app).

1. Vào **business.facebook.com** → **Business settings** (Cài đặt doanh nghiệp).
2. Menu trái → **Security Center** (Trung tâm bảo mật).
3. Bấm **Start Verification** → nhập:
   - Tên pháp lý doanh nghiệp (khớp giấy phép)
   - Địa chỉ, số điện thoại, website (https://lumiobooking.com)
4. Tải lên **giấy tờ**: giấy phép kinh doanh / EIN letter / hoá đơn tiện ích có tên + địa chỉ công ty.
5. Xác minh số điện thoại/email doanh nghiệp qua mã.
6. Chờ Meta duyệt (thường 1–3 ngày).

> Nếu chưa có pháp nhân Mỹ, dùng pháp nhân bạn đang đăng ký. Meta cần khớp tên trên giấy tờ.

---

## 2. Hoàn thiện App Settings → Basic

App Dashboard → **App settings → Basic**, điền đủ:

- **App icon**: logo Lumio 1024×1024 px (nền vuông).
- **Privacy Policy URL**: `https://lumiobooking.com/privacy`
- **Terms of Service URL**: `https://lumiobooking.com/terms`
- **User Data Deletion**: chọn **"Data Deletion Instructions URL"** → dán `https://lumiobooking.com/data-deletion`
  *(hoặc chọn Callback và dán `https://lumio-api-uqm6.onrender.com/api/messenger/data-deletion` — cả hai đều đã sẵn sàng)*
- **Category**: Business and Pages (hoặc Productivity).
- **Business Use**: gắn app vào Business Portfolio đã verify ở Bước 1.

Bấm **Save changes**.

---

## 3. Data Deletion — ĐÃ CODE SẴN ✅

Bạn không phải làm gì thêm về kỹ thuật. Hệ thống đã có:
- **Callback**: `POST /api/messenger/data-deletion` — nhận `signed_request` của Facebook, xác minh chữ ký bằng App Secret, xoá toàn bộ dữ liệu hội thoại của người dùng đó, trả về `{ url, confirmation_code }` đúng chuẩn Meta.
- **Trang hướng dẫn**: `https://lumiobooking.com/data-deletion` — nêu rõ dữ liệu lưu gì, cách yêu cầu xoá (gỡ app hoặc email).

Chỉ cần **dán URL** vào Bước 2 ở trên (sau khi `deploy.bat`).

---

## 4. Quyền cần xin + giải trình (dán vào App Review)

App Dashboard → **App Review → Permissions and Features** → mỗi quyền bấm **Request advanced access** và dán phần giải trình tương ứng.

### `pages_messaging` (cốt lõi)

> **PASTE:**
> Lumio Booking is an appointment-booking assistant that nail salons install on their own Facebook Page. When a customer messages the salon's Page, our app uses pages_messaging to read the incoming message and send an automated reply that answers questions (hours, services, prices) and books the appointment into the salon's calendar. The salon owner explicitly connects their own Page via Facebook Login for Business and enables the assistant. Without this permission the assistant cannot receive or reply to customer messages, which is the core function of the product.

### `pages_show_list`

> **PASTE:**
> Used only during setup so the salon owner can see the list of Facebook Pages they manage and choose which Page to connect to Lumio Booking. We do not read any Page content with this permission.

### `pages_manage_metadata`

> **PASTE:**
> Used to subscribe the salon's selected Page to our webhook so we can receive the customer messages the salon owner has authorized us to handle. This is required for pages_messaging to deliver message events to our server.

### `business_management`

> **PASTE:**
> Required by Facebook Login for Business so the salon owner can select the business portfolio and Page they want to connect. We use it only to complete the connection the owner initiates; we do not manage the business otherwise.

### (Nếu bật Instagram) `instagram_basic`

> **PASTE:**
> Used to identify the Instagram Business account linked to the salon's connected Facebook Page, so the assistant can route Instagram Direct Messages to the correct salon. Read-only.

### (Nếu bật Instagram) `instagram_manage_messages`

> **PASTE:**
> Same core use as pages_messaging, for Instagram: read the customer's Direct Message to the salon's Instagram Business account and send an automated reply that answers questions and books the appointment.

---

## 5. Mô tả tổng quan app (App Review → "Tell us how you'll use…")

> **PASTE:**
> Lumio Booking is a multi-tenant SaaS used by nail salons in the US. Each salon connects its own Facebook Page (and optionally Instagram) through Facebook Login for Business. Once connected, an AI assistant automatically replies to customers who message the salon, answers common questions (opening hours, services, prices, location), collects the customer's name, phone and preferred time, and creates the appointment in the salon's booking calendar. The salon owner controls the assistant from their Lumio dashboard and can turn it off or hand a conversation to a human at any time. We request messaging permissions solely to receive and reply to messages that customers voluntarily send to the salon's Page.

---

## 6. Kịch bản quay VIDEO DEMO (Meta bắt buộc)

Quay màn hình 1 video liền mạch (2–4 phút), có thể lồng tiếng/chú thích tiếng Anh. Phải cho reviewer thấy **quyền hoạt động thật**.

1. **(0:00)** Mở `https://lumiobooking.com` → đăng nhập tài khoản salon demo. Nói: *"This is the salon owner's Lumio dashboard."*
2. **(0:15)** Vào **Messenger bot** → bấm **"Connect with Facebook"**. Cho thấy màn **Facebook Login for Business**, đăng nhập, **chọn Page**, bấm Continue. Nói: *"The salon owner connects their own Page and grants messaging access."*
3. **(0:45)** Quay lại dashboard hiện **"● Connected"** + bật **Enable the bot**.
4. **(1:00)** Mở Messenger bằng **một tài khoản khách khác**, nhắn vào Page: *"Hi, what are your hours and can I book a gel manicure Saturday 2pm?"*
5. **(1:15)** Cho thấy **bot tự trả lời**: trả lời giờ mở cửa, hỏi tên/SĐT, rồi xác nhận đặt lịch. (Đây là phần quan trọng nhất — quyền `pages_messaging` đang hoạt động.)
6. **(1:45)** Quay lại dashboard → mở **Calendar** cho thấy **lịch hẹn vừa được tạo**.
7. **(2:00)** (Nếu xin Instagram) lặp lại bước 4–5 bằng **Instagram DM**.
8. **(kết)** Cho thấy nút **Disconnect** và toggle tắt bot. Nói: *"The owner can disconnect or hand off to a human anytime."*

> Mẹo: quay ở chế độ đã thêm reviewer làm Tester, hoặc dùng 2 tài khoản của bạn. Đảm bảo thấy rõ tin nhắn khách → bot trả lời trong cùng khung chat.

---

## 7. Hướng dẫn reviewer test (dán vào "Instructions for reviewer")

> **PASTE:**
> Test steps:
> 1. Open https://lumiobooking.com and log in with the demo salon account:
>    - Email: [ĐIỀN EMAIL TÀI KHOẢN DEMO]
>    - Password: [ĐIỀN MẬT KHẨU DEMO]
> 2. In the left menu open "Messenger bot". The Page is already connected and the bot is enabled.
> 3. From any Facebook account, open Messenger and send a message to our test Page:
>    - Page: Lumio Booking — https://m.me/1213688201821751
>    - Example message: "Hi, what are your hours? Can I book a gel manicure this Saturday at 2pm?"
> 4. The assistant will reply automatically, answer the question, ask for name and phone, and confirm the booking.
> 5. Back in the dashboard, open "Calendar" to see the appointment that was created.
> (For Instagram: send a Direct Message to the linked Instagram account and observe the same automated reply.)

*(Ghi chú: thay `m.me/1213688201821751` bằng link Page thật nếu khác, và điền tài khoản demo bạn tạo riêng cho reviewer.)*

---

## 8. Tech Provider (cho mô hình nhiều tiệm)

Vì bạn cho **nhiều doanh nghiệp khác** (các salon) connect Page của họ:

1. App Dashboard → có mục **"Become a Tech Provider"** → bấm và hoàn tất **access verification** (xác minh doanh nghiệp mở rộng — dùng chung hồ sơ Bước 1).
2. Điều này cho phép app xin quyền truy cập Page/tài sản của **business khác** ở quy mô lớn — đúng bản chất SaaS multi-tenant.

> Nếu ban đầu chỉ chạy cho **các tiệm bạn tự quản lý**, có thể chưa cần Tech Provider. Nhưng để mở bán cho tiệm ngoài, nên làm.

---

## 9. Checklist lên Live (bấm Publish)

- [ ] Business Verification đã duyệt (Bước 1)
- [ ] App Basic điền đủ: icon, Privacy, Terms, Data Deletion, Category (Bước 2)
- [ ] `deploy.bat` đã chạy → trang `/data-deletion` + callback đã live (Bước 3)
- [ ] Đã thêm 6 giá trị URL/Redirect/Webhook vào Meta (mục 0)
- [ ] App Review: đã xin `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `business_management` (+ 2 quyền Instagram nếu dùng) với giải trình (Bước 4)
- [ ] Đã upload video demo (Bước 6) + hướng dẫn reviewer (Bước 7)
- [ ] (Tùy chọn) Tech Provider (Bước 8)
- [ ] Meta duyệt xong → bật **Publish → Live**

Khi app **Live** + quyền được duyệt → **mọi khách hàng thật** nhắn tin đều được bot trả lời, cho **tất cả salon** đã connect.

---

## Phụ lục — việc cần làm ngay của bạn

1. **Chạy `deploy.bat`** để đưa trang `/data-deletion` + callback lên.
2. Kiểm tra: mở `https://lumiobooking.com/data-deletion` phải thấy trang hướng dẫn.
3. Bắt đầu **Business Verification** (Bước 1) — cần giấy tờ, nên làm sớm vì chờ lâu nhất.
4. Tạo **1 tài khoản salon demo** riêng cho reviewer (đừng dùng tài khoản thật).
5. Quay **video demo** theo kịch bản Bước 6.
