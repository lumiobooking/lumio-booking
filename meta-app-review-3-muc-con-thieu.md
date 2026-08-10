# Điền 3 mục còn lại trong form App Review

Màn hình bạn đang mở: Verification ✓ · App settings ✓ · **Allowed usage** ○ · **Data handling** ⚠️ · **Reviewer instructions** ⚠️

> ⚠️ **Làm trước tiên**: deploy `lumio-web` để chính sách bảo mật mới có hiệu lực. Tôi vừa bổ sung 2 mục bắt buộc mà bản cũ thiếu — **Facebook Messenger & Instagram messaging** và **Automated replies (AI)**. Reviewer luôn mở link privacy policy; thiếu phần mô tả dữ liệu Meta là lý do từ chối rất phổ biến. Kiểm tra `lumiobooking.com/privacy` thấy đủ 2 mục mới rồi mới nộp.

---

## MỤC 1 — Allowed usage

Meta hỏi bạn có dùng dữ liệu vào các mục đích bị cấm không. Trả lời **KHÔNG** cho tất cả các câu dạng sau (đọc kỹ từng câu vì Meta hay đảo cách hỏi):

| Câu hỏi dạng | Trả lời |
|---|---|
| Bán, cho thuê, trao đổi dữ liệu nền tảng cho bên thứ ba | **No** |
| Dùng dữ liệu để nhắm quảng cáo, xây dựng hồ sơ người dùng, tệp đối tượng | **No** |
| Dùng cho giám sát (surveillance), theo dõi cá nhân | **No** |
| Dùng để quyết định điều kiện vay, bảo hiểm, việc làm, nhà ở, học bổng | **No** |
| Dùng để phân biệt đối xử | **No** |
| Chuyển dữ liệu cho bên môi giới dữ liệu (data broker) | **No** |
| Dùng để huấn luyện mô hình AI của bên thứ ba | **No** |

Nếu có ô mô tả tự do, dán:

```
Platform Data is used solely to operate the messaging assistant for the business
that connected its own Page: to read the incoming customer message, generate a
reply about that business's services, prices and opening hours, and create the
appointment the customer requests. We do not sell, rent or share Platform Data,
do not use it for advertising, profiling, audience building or surveillance, and
do not use it to train any AI model.
```

---

## MỤC 2 — Data handling

Trả lời trung thực theo đúng hạ tầng thật của bạn.

**Nơi lưu trữ / hạ tầng**

```
Application servers run on Render (United States). The database is PostgreSQL
hosted on Neon (United States). No Platform Data is stored outside these
providers.
```

**Mã hoá**

```
All data is encrypted in transit with TLS 1.2+. Data at rest is encrypted by our
hosting providers (Render and Neon). Page access tokens are stored server-side
only and are never exposed to the browser or to any client application.
```

**Ai truy cập được**

```
Access is limited to authorised Lumio staff on a need-to-know basis, protected by
role-based access control. Each business account can only access its own data;
this isolation is enforced in every database query. Administrative access to a
business account is time-limited and recorded in an audit log.
```

**Nhà cung cấp / bên xử lý (nêu đủ, đừng giấu)**

```
- Render (application hosting, United States)
- Neon (database hosting, United States)
- Anthropic (AI provider used to generate the assistant's replies; message text
  is processed to produce the reply and is not used to train models)
- Email and SMS providers used to send appointment confirmations and reminders
```

**Lưu bao lâu / xoá thế nào**

```
Conversation history is limited to the most recent messages needed to keep the
conversation coherent. When a business disconnects its Page, the stored Page
token is revoked immediately and message processing stops. When a business
account is deleted, all of its data, including conversations, is deleted.
End users may request deletion at any time via
https://lumiobooking.com/data-deletion
```

**Nếu hỏi về bảo mật tổ chức (security practices)**

```
Access to production systems requires individual accounts with strong
authentication. Secrets and tokens are stored as environment variables, never in
source control. Important administrative actions are written to an audit log with
the acting user, the business account and a timestamp.
```

---

## MỤC 3 — Reviewer instructions

Dán nguyên khối dưới đây. Nhớ điền email/mật khẩu thật của tenant **Lumio Salon**.

```
TEST ACCOUNT
Login page: https://lumiobooking.com/login
Email:      <điền email của tenant Lumio Salon>
Password:   <điền mật khẩu>

The test account is a demo nail salon with real services, staff and opening hours
already configured, and a Facebook Page already connected, so the end result is
visible immediately.

WHAT THE APP DOES
Lumio Booking is a booking and messaging platform for salons, spas and
restaurants. A business owner connects their own Facebook Page (and optionally the
linked Instagram professional account) so that customer messages are answered
automatically and turned into appointments in the business's calendar.

STEPS TO REPRODUCE

1. Open https://lumiobooking.com/login and sign in with the credentials above.

2. In the left menu, under "MARKETING & AI", click "Messenger bot".

3. In the "Connection details" panel you can see the connected Page: its name,
   its ID and the webhook subscription status. The Page name shown here is the
   data read with pages_read_engagement and pages_show_list.

4. Click "+ Add page / reconnect" to run the connection flow from the start.
   You are redirected to Facebook Login.

5. Sign in with a Facebook account that administers at least one Page, and grant
   the requested permissions (choose "Opt in to all current and future Pages").

6. You return to the dashboard. If the account administers several Pages, the app
   lists them by name so the owner can select the correct one; click
   "Use this page". A green banner confirms the Page is connected and subscribed
   to our webhook.

7. Open Facebook Messenger and send a message to the connected Page, for example:
   "Do you do gel manicures and how much?"
   The assistant replies within a few seconds using the salon's real services and
   prices. Continue with:
   "I'd like to book a luxury manicure tomorrow at 2pm", then a name, then a phone
   number. The assistant creates the appointment.

8. Back in the dashboard, open "Calendar" to see the appointment that was just
   created, and "Messenger bot > Conversations" to see the same exchange logged,
   including the control a staff member uses to take over the conversation.

9. INSTAGRAM: the same assistant answers direct messages sent to the Instagram
   professional account linked to that Page, using instagram_basic to identify the
   account and instagram_manage_messages to receive and reply to the direct
   messages. The reply logic, the business data used and the dashboard view are
   identical to Messenger.

NOTES
- We do not read post insights, reactions, comments, ratings or advertising data.
- pages_read_engagement is used only to read the Page name and token when listing
  the Pages the person administers; for Pages owned by a Meta Business Manager the
  standard /me/accounts response is often incomplete and this permission is the
  only way those owners can see and connect their own Page.
- The assistant only answers messages for Pages the owner explicitly connected.
```

---

## Trước khi bấm Submit — kiểm tra 8 dòng

- [ ] `lumio-web` đã deploy, mở `lumiobooking.com/privacy` thấy mục **Facebook Messenger & Instagram messaging** và **Automated replies (AI)**
- [ ] `lumio-api` đã deploy bản mới nhất
- [ ] Super Admin → Tenants → **Lumio Salon** → 🔒 Feature access → tick **Messenger bot** → Save
- [ ] Business Suite → page Lumio Booking → **Automations: tắt hết**
- [ ] Đăng nhập thử bằng cửa sổ ẩn danh đúng email/mật khẩu ghi trong hồ sơ → vào được trang Messenger bot
- [ ] Nhắn thử vào page → bot trả lời có **giá thật** trong vài giây
- [ ] Video đã quay đủ cảnh **màn hình cấp quyền của Facebook** (cảnh dễ thiếu nhất)
- [ ] Nếu nộp kèm Instagram: đã đặt `FB_ENABLE_INSTAGRAM=1`, kết nối lại page, bật "Cho phép truy cập tin nhắn" trong app Instagram, và **video có đoạn nhắn tin Instagram**

> Nếu chưa kịp chuẩn bị phần Instagram, cứ nộp `pages_read_engagement` trước. Instagram nộp đợt sau cũng được — nhưng phải có video riêng chứng minh Instagram hoạt động, nếu không sẽ bị từ chối vì "không chứng minh được cách dùng quyền".
