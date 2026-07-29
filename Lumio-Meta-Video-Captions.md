# Meta App Review — English captions (dán vào CapCut theo thứ tự cảnh)

Mỗi caption hiện 2–4 giây, chữ trắng nền đen mờ, đáy màn hình.

## Phần A — Đăng nhập & cấp quyền
1. Lumio Booking — online booking software for nail salons (lumiobooking.com)
2. The salon admin signs in to the Lumio admin console (test credentials are provided in the review instructions)
3. Salon dashboard — open "Messenger bot" from the left menu
4. Not connected yet — click "Connect with Facebook" to start Facebook Login
5. Step 1 — The complete Meta login flow: continue as the Page administrator
6. Step 2 — Asset selection: choose the Facebook Page "Lumio Booking"
7. Select the business portfolio that owns the Page
8. Step 3 — Granting access: Messenger conversations, Page settings & webhooks, and the Page list (pages_messaging, pages_manage_metadata, pages_show_list, business_management)
9. Facebook confirms the connection — click "Got it"

## Phần B — Subscribe webhook + event đi vào app (pages_manage_metadata)
10. Back in Lumio: Page connected ✓ and the app subscribed the Page to webhook events via POST /{page-id}/subscribed_apps ✓
11. Connection details — Page name & ID, Webhook subscription: Active, subscribed events (messages, messaging_postbacks, message_reactions) — read live from GET /{page-id}/subscribed_apps
12. Now acting as a CUSTOMER on a real phone (mirrored on the right)
13. Searching for the same "Lumio Booking" Page on Facebook
14. Opening the Page and tapping "Message" — a native Messenger conversation
15. The customer sends a message with the review test ID — this fires a "messages" webhook event to the app
16. The app receives the webhook and its AI assistant replies through the Messenger Send API
17. The customer picks a service — "Manicure $25"
18. The assistant books the appointment and confirms — the end-to-end use case
19. The webhook events arrive in the app: Messenger Activity logs every Incoming (Received) and Outgoing (Sent) message, tied to the same Page
20. The booking made in Messenger appears in the salon calendar — Source: Messenger

## Phần C — Live send từ app + delivered trong native client (pages_messaging)
21. A live send action from the app UI — the admin types a reply and clicks "Send message" (POST /me/messages)
22. The SAME message is delivered in the native Messenger client on the phone
23. Messenger Activity logs the manual send as Outgoing / Sent — alongside every Incoming / Received webhook event, tied to the same Page

## Notes dán vào Meta khi Request again (mỗi quyền một ô)

### pages_manage_metadata
Lumio Booking is a SaaS appointment-booking assistant for nail salons. A salon
admin connects their own Facebook Page via Facebook Login (0:00–1:00).

pages_manage_metadata subscribes the connected Page to our webhook so the salon
receives customer messages. On connect the app calls
POST /{page-id}/subscribed_apps (fields: messages, messaging_postbacks,
message_reactions).

In the screencast:
- ~1:07 "Connection details" shows the Page name + ID and "Webhook
  subscription: Active" with the subscribed events — read live from
  GET /{page-id}/subscribed_apps.
- ~3:34 a test user messages the SAME Page from the Messenger app on a phone.
- ~3:35 the webhook events arrive and appear in "Messenger Activity"
  (Incoming / Received), tied to the same Page shown during setup.

This is a standard Facebook Login app (no system-user token); the full login
and permission-grant flow is visible in the video.

### pages_messaging
pages_messaging lets the salon reply to customers who messaged its Page, within
the standard 24-hour window. Our AI assistant also answers automatically and
books appointments (end-to-end use case shown: the booking created in Messenger
appears in the salon calendar at ~5:27).

In the screencast:
- ~5:00 asset selection: "Sending as: Lumio Booking" + the recipient
  conversation are visible in the app.
- ~7:30 a live send action from our app UI: the admin types a message and
  clicks "Send message", which calls POST /me/messages.
- ~7:43 the SAME message is shown delivered in the native Messenger client on
  the phone.
- ~7:50 the outgoing message is logged in "Messenger Activity" as Sent.

The Page name and Page ID are visible in "Connection details" throughout.

---

## App Testing Instructions — dán vào ô "Testing instructions" khi submit (KHÔNG đưa vào video)

TEST CREDENTIALS (Lumio salon admin console):
URL: https://lumiobooking.com/login
Email: service.lumioagency@gmail.com
Password: Lumio@2026
(No 2FA. The account stays active for the entire review period.)

HOW TO TEST:
1. Sign in at https://lumiobooking.com/login with the credentials above.
2. In the left menu, open "Messenger bot" (under MARKETING & AI).
3. The Facebook Page "Lumio Booking" (Page ID 1213688201821751) is already
   connected. "Connection details" shows the live webhook subscription
   (Status: Active) with the subscribed events — this is read in real time
   from GET /{page-id}/subscribed_apps.
4. pages_manage_metadata: send any message to the "Lumio Booking" Page from
   Messenger. Within seconds it appears in "Messenger Activity" as
   Incoming / Received (webhook event), and the AI assistant replies.
5. pages_messaging: in "Send a test message", pick the conversation and click
   "Send message" — a live POST /me/messages call from the app UI. The message
   is delivered in Messenger and logged as Outgoing / Sent.
6. Bookings made in the Messenger conversation appear in Calendar
   (Source: Messenger) — the end-to-end use case.

The app uses standard Facebook Login (frontend OAuth). No system-user token.

---

## Sau khi nộp — GIỮ NGUYÊN trong suốt thời gian chờ duyệt

- KHÔNG đổi mật khẩu tài khoản test ở trên.
- KHÔNG bấm Disconnect — giữ Page "Lumio Booking" đang kết nối + bot Enabled
  (reviewer có thể tự nhắn Page để test live).
- KHÔNG bấm "Clear ALL conversations" nữa — giữ lịch sử Activity làm bằng chứng.
- Giữ 2 service Render (lumio-api, lumio-web) đang chạy.
