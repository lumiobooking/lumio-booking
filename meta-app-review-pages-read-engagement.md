# Hồ sơ App Review — `pages_read_engagement` (Lumio Booking)

App ID **1707103183956838** · Chuẩn bị 08/08/2026
Mục tiêu: được duyệt ngay lần nộp này. Lần trước trượt vì (1) mô tả use case chưa đạt, (2) video demo chưa đạt, (3) reviewer thấy tính năng chưa rõ ràng. Hồ sơ này xử lý cả ba.

---

## PHẦN 0 — Hiểu người review chấm cái gì

Người review **không đọc code**. Họ làm đúng 3 việc:

1. Đọc mô tả của bạn → hiểu app dùng dữ liệu vào việc gì.
2. Đăng nhập bằng tài khoản test bạn cung cấp → tự bấm lại luồng đó.
3. Xem video → đối chiếu xem có khớp mô tả không.

Trượt gần như luôn vì **họ không tự làm lại được**, chứ không phải vì sản phẩm dở. Vì vậy: mô tả và video phải khớp từng bước với thứ họ sẽ thấy trên màn hình.

---

## PHẦN 1 — Kiểm tra trước khi bấm Submit (làm hết, đừng bỏ mục nào)

Vào **App Dashboard → App settings → Basic**, xác nhận đủ:

| Mục | Giá trị cần điền |
|---|---|
| Privacy Policy URL | `https://lumiobooking.com/privacy` |
| Terms of Service URL | `https://lumiobooking.com/terms` |
| User Data Deletion | `https://lumiobooking.com/data-deletion` |
| App Icon | Logo Lumio 1024×1024 |
| Category | Business and Pages |
| App Domains | `lumiobooking.com` |
| Business verification | Đã xác minh (bắt buộc cho `business_management`) |
| App Mode | **Live** (không phải Development) |

Mở thử 3 đường link trên bằng cửa sổ ẩn danh — phải hiện nội dung thật, không lỗi 404. Reviewer bấm vào đó đầu tiên.

---

## PHẦN 2 — Tài khoản test cho reviewer

Dùng tenant **Lumio Salon** (đã có 66 dịch vụ, 3 thợ, page Lumio Booking đã kết nối, bot đang bật).

Điền vào ô **App Review → Test credentials**:

```
Email:    (email đăng nhập của tenant Lumio Salon)
Password: (mật khẩu — nếu bạn không nhớ, đổi mật khẩu mới rồi điền vào đây)
Login URL: https://lumiobooking.com/login
```

> Tự bạn đặt và điền mật khẩu. Sau khi được duyệt thì đổi lại mật khẩu.

**Kiểm tra bắt buộc trước khi nộp**: mở cửa sổ ẩn danh → đăng nhập đúng email/mật khẩu đó → vào được `/salon/messenger` và thấy trang Messenger bot. Nếu bạn không vào được thì reviewer cũng không, và hồ sơ trượt ngay.

---

## PHẦN 3 — Mô tả use case (dán nguyên văn vào ô của Meta)

### 3.1 Ô "How will your app use this permission?" — `pages_read_engagement`

```
Lumio Booking is a booking and customer-messaging platform for salons, spas and
restaurants in the United States. Business owners connect their own Facebook Page
so that customer enquiries sent to that Page are answered automatically and turned
into appointments in their Lumio calendar.

We request pages_read_engagement for exactly one purpose: to read the basic
identity of the Pages the person already administers, so they can choose the
correct Page to connect to their salon account.

Specifically, when a business owner clicks "Connect with Facebook" in their Lumio
dashboard, we call GET /me/accounts to list their Pages. For business owners whose
Page is owned by a Meta Business Manager, that endpoint frequently returns an
incomplete list. In those cases we fall back to reading the granular scopes on the
access token and fetching each granted Page node directly (GET /{page-id}?fields=
name,access_token). That single read requires pages_read_engagement. Without it,
those owners see an empty Page list and cannot connect their own Page at all.

We read only the Page name and the Page access token needed to bind the Page to
the owner's salon account. We do not read post insights, reactions, comments,
ratings, page metrics, or any other engagement data, and we do not store any such
data. The Page name is shown once in the selection screen and stored with the
connection so the owner can see which Page is linked.

This permission is used only during the connection step initiated by the Page
administrator, never in the background and never for any Page the person has not
explicitly granted.
```

### 3.2 Ô "Tell us how you're using..." cho các quyền đang gia hạn (nếu Meta hỏi lại)

```
pages_show_list — to list the Pages the business owner administers so they can
pick which Page to connect to their salon account.

pages_messaging — to receive customer messages sent to the connected Page and
reply on the Page's behalf: answering questions about services, prices and opening
hours, and creating appointments in the salon's calendar.

pages_manage_metadata — to subscribe our webhook to the connected Page so incoming
messages are delivered to our server, and to set the Page's Messenger greeting.

business_management — to identify Pages that are owned by the business owner's
Meta Business Manager, so those Pages can be listed and connected.

public_profile — to identify the person connecting the Page.
```

---

## PHẦN 4 — Hướng dẫn thao tác cho reviewer (dán vào ô "Step-by-step instructions")

Viết đúng như dưới đây. Mỗi bước phải là thứ nhìn thấy được trên màn hình.

```
TEST ACCOUNT
Login page: https://lumiobooking.com/login
Email:      <điền>
Password:   <điền>

The test account is a demo nail salon ("Lumio Salon") with real services, staff and
opening hours already configured, and a Facebook Page already connected so you can
see the end result immediately.

STEPS TO REPRODUCE

1. Open https://lumiobooking.com/login and sign in with the credentials above.
   You will land on the salon dashboard.

2. In the left menu under "MARKETING & AI", click "Messenger bot".
   You are now on the screen where a business owner connects their Facebook Page.

3. Observe the "Connection details" panel: it shows the Page name, Page ID and the
   webhook subscription status of the Page that is already connected. The Page name
   shown here is the data read with pages_read_engagement / pages_show_list.

4. To see the permission in use from the start, click the blue button
   "+ Add page / reconnect". You are redirected to Facebook Login.

5. Log in with any Facebook account that administers at least one Page, and grant
   the requested permissions (choose "Opt in to all current and future Pages").

6. You are returned to the Lumio dashboard. If the account administers several
   Pages, a selection card appears listing each Page by NAME and ID — this list is
   what pages_read_engagement makes possible for Business-Manager-owned Pages.
   Click "Use this page" on the desired Page.

7. A green banner confirms the Page is connected and subscribed to our webhook.

8. To see what the connection is for, open Facebook Messenger and send a message to
   the connected Page, for example "Do you do gel manicures and how much?".
   The assistant replies within a few seconds using the salon's real services and
   prices, and can create an appointment in the salon calendar.

9. Back in the dashboard, scroll to "Conversations" to see the same exchange logged,
   and the "Take over" control a human staff member uses to pause the assistant.

NOTES
- No engagement data (insights, reactions, comments, ratings) is read or stored.
  We use pages_read_engagement solely to read the Page name/token when listing the
  Pages the person administers.
- The assistant only answers messages for Pages the owner explicitly connected.
```

---

## PHẦN 5 — Kịch bản quay video (bám sát, đừng cắt bước)

Yêu cầu kỹ thuật: **quay màn hình desktop, không cắt cảnh, một mạch, 2–4 phút, tiếng Anh phụ đề hoặc thuyết minh, độ phân giải ≥ 1080p**. Meta trượt video bị cắt ghép vì không chứng minh được luồng liền mạch.

| # | Thời lượng | Quay gì | Phải nhìn thấy rõ trên màn hình |
|---|---|---|---|
| 1 | 0:00–0:10 | Mở `lumiobooking.com/login` | Thanh địa chỉ URL |
| 2 | 0:10–0:25 | Đăng nhập bằng tài khoản test | Gõ email, bấm Sign in, vào dashboard |
| 3 | 0:25–0:40 | Bấm menu **Messenger bot** | Trang Messenger bot hiện đầy đủ |
| 4 | 0:40–0:55 | Trỏ vào khối **Connection details** | Page name + Page ID + Webhook: Active |
| 5 | 0:55–1:05 | Bấm **+ Add page / reconnect** | Chuyển sang màn hình Facebook Login |
| 6 | 1:05–1:30 | Màn hình cấp quyền của Meta | **Quay trọn** màn hình chọn Page và màn hình liệt kê quyền — đây là bằng chứng quan trọng nhất |
| 7 | 1:30–1:45 | Quay lại dashboard | Bảng chọn page: tên page + ID; bấm **Use this page** |
| 8 | 1:45–1:55 | Kết quả | Banner xanh "connected" + webhook Active |
| 9 | 1:55–2:40 | Mở Messenger, nhắn tin cho page | Gõ "Do you do gel manicures and how much?" → **bot trả lời có giá thật** |
| 10 | 2:40–3:00 | Quay lại dashboard, mục Conversations | Hội thoại vừa rồi hiện trong danh sách |

**Ba lỗi làm trượt video — tránh tuyệt đối:**

- Không quay màn hình cấp quyền của Meta (bước 6). Thiếu bước này là trượt gần như chắc chắn.
- Quay bằng tài khoản chưa đăng xuất sẵn, khiến đoạn đăng nhập bị nhảy cóc → reviewer nghi ngờ không tái hiện được.
- Bot trả lời chung chung, không có giá/dịch vụ thật → rơi vào đúng lý do "tính năng chưa rõ ràng" lần trước. Hãy hỏi câu có giá cụ thể.

**Nên quay thêm 20 giây cuối** (tăng điểm "tính năng rõ ràng"): mở trang **Services** cho thấy 66 dịch vụ có giá thật, và trang **Calendar** cho thấy lịch hẹn — chứng minh đây là sản phẩm hoàn chỉnh chứ không phải demo dựng tạm.

---

## PHẦN 6 — Diễn tập trước khi nộp (làm trong 15 phút)

Mở **cửa sổ ẩn danh** và tự đóng vai reviewer, làm đúng Phần 4 từ bước 1 đến 9. Đánh dấu từng dòng:

- [ ] Đăng nhập được bằng đúng email/mật khẩu đã ghi trong hồ sơ
- [ ] Menu **Messenger bot** hiện ra (tenant Lumio Salon phải được bật `messengerAi` = salon trong Super Admin → Feature access, nếu không reviewer sẽ không thấy menu)
- [ ] Connection details hiện Page name, Page ID, Webhook **Active**
- [ ] Bấm Add page → sang được Facebook, hiện màn hình quyền
- [ ] Quay lại thấy banner xanh
- [ ] Nhắn cho page → **bot trả lời trong vài giây, có tên dịch vụ và giá thật**
- [ ] Hội thoại hiện trong mục Conversations
- [ ] Ba link chính sách mở được, không 404

Chỉ bấm Submit khi cả 8 dòng đều tick.

---

## PHẦN 7 — Việc phải làm trên hệ thống trước khi nộp

1. **Bật Messenger bot cho tenant Lumio Salon**: Super Admin → Tenants → Lumio Salon → 🔒 Feature access → tick **Messenger bot** → Save. *(Không làm bước này thì reviewer đăng nhập vào sẽ không thấy menu — trượt ngay.)*
2. **Tắt Automations trong Business Suite** của page Lumio Booking (Instant reply / Away message) — nếu không, Meta tự trả lời trước và bot im, reviewer kết luận tính năng không hoạt động.
3. **Đảm bảo `lumio-api` đang chạy bản mới nhất** (bộ hạn chót chống treo) để bot không im giữa chừng lúc reviewer thử.
4. Không sửa đổi use case hay quyền của app trong lúc chờ duyệt.

---

## PHẦN 8 — Nếu vẫn bị từ chối

Meta ghi mã lý do trong thông báo. Cách xử lý theo từng nhóm:

| Lý do Meta ghi | Nghĩa là | Sửa thế nào |
|---|---|---|
| "We were unable to log in" | Sai mật khẩu, hoặc tài khoản bị khóa | Kiểm tra lại bằng cửa sổ ẩn danh, nộp lại |
| "Unable to reproduce the steps" | Hướng dẫn lệch màn hình thật | Chụp lại từng bước đúng giao diện hiện tại, viết lại Phần 4 |
| "Screencast does not demonstrate..." | Thiếu màn hình cấp quyền | Quay lại theo bảng ở Phần 5, đủ bước 6 |
| "Permission not necessary for your use case" | Mô tả chưa nêu rõ vì sao **bắt buộc** phải có | Nhấn mạnh: không có nó, chủ tiệm có page trong Business Manager thấy danh sách trống và không kết nối được |

Nộp lại được không giới hạn số lần, và lần nộp lại không ảnh hưởng các quyền đang chạy.
