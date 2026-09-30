# Meta App Review — Human Agent bị từ chối & danh sách quyền xin 1 lần

Ngày: 30/09/2026 · Kết quả review: **Rejected: Human Agent** — lý do "Messenger Bot Not Functional" (Developer Policy 1.6). 11 quyền còn lại được **Renewed** (gia hạn, vẫn dùng bình thường).

---

## 1. Lỗi là gì

Meta chỉ từ chối **một** mục: quyền **Human Agent** (nhãn `HUMAN_AGENT` cho phép nhân viên trả lời khách trong 7 ngày thay vì 24 giờ). Lý do ghi là *bot không hoạt động*: người duyệt nhắn tin vào Page test trong hướng dẫn (m.me/1213688201821751 — "Lumio Booking") và **không nhận được trả lời**, hoặc không thấy được cảnh "người thật trả lời sau 24 giờ".

Trong mã nguồn, có đúng 5 chỗ làm bot **im lặng mà không báo lỗi** — đây là những thứ cần kiểm tra trên Page test trước khi nộp lại:

| # | Chỗ im lặng | Ở đâu trong Lumio | Cách kiểm tra |
|---|---|---|---|
| 1 | Page test không còn kết nối / token hết hạn | Salon → Messenger bot → Trạng thái webhook | Phải thấy "connected" + "subscribed: messages, messaging_postbacks…" |
| 2 | Bot đang **tắt** trên tenant của Page test (`conn.enabled = false`) | Messenger bot → công tắc Bật bot | Bật |
| 3 | Cuộc trò chuyện của người duyệt đang ở trạng thái **người thật đang giữ** (ai đó từ Lumio đã trả lời họ từ Page inbox hoặc bấm "Tôi nhận" ở lần review trước) → bot đứng yên | Hộp thư → tìm thread của reviewer | Bấm "Trả lại bot" / mở khoá; hoặc gọi `POST /messenger/clear-review-data` để xoá dữ liệu test cũ |
| 4 | "Chia ca" bật nhưng **Bot trả lời trước** tắt (`botFirst = false`) → tin nhắn giao cho nhân viên, bot không nói | Hộp thư → ca trực | Bật "Bot trả lời trước" trên tenant test |
| 5 | AI lỗi (hết credit / key sai) → gửi câu xin lỗi rồi giao người | Log Render, mục "AI health" | Nhắn thử từ tài khoản cá nhân: phải có trả lời trong < 10 giây |

**Bước bắt buộc trước khi bấm Request again:** từ một tài khoản Facebook cá nhân (không phải admin app), nhắn vào Page test câu tiếng Anh trong hướng dẫn. Nếu bot trả lời ngay → mục 1–5 ổn. Nếu không → sửa theo bảng trên, chưa nộp.

### Riêng Human Agent còn thiếu gì

Người duyệt Human Agent cần **nhìn thấy nhãn được dùng**, không chỉ thấy bot. Video và hướng dẫn phải có cảnh:

1. Khách nhắn Page (mốc thời gian rõ ràng).
2. **Hơn 24 giờ sau**, nhân viên mở Lumio → Hộp thư → thread đó. Thanh thông báo trong khung soạn tin hiện: *"Past 24 hours — this goes out under Meta's human-agent tag. About N day(s) left. The bot can no longer message."* (đây chính là nơi nhãn `HUMAN_AGENT` được gắn — mã ở `apps/api/src/messenger/human-agent.ts`).
3. Nhân viên gõ trả lời → tin đến Messenger của khách. Quay cả 2 màn hình (Lumio + Messenger khách).

Video cũ chỉ quay bot trả lời tự động → đủ cho `pages_messaging`, **không đủ** cho Human Agent. Cần quay thêm cảnh trên (bắt buộc chờ thật 24 giờ giữa 2 lần quay, hoặc dùng thread có sẵn đã quá 24 giờ).

---

## 2. Toàn bộ quyền hệ thống đang dùng — xin một lần cho đủ

Đối chiếu từ mã nguồn (`messenger.service.ts` dòng 343–397 dựng hộp thoại OAuth; các lệnh Graph API trong `messenger/`, `content/`, `marketing/`).

### A. Đã được duyệt / gia hạn (11 mục trong ảnh) — không cần làm gì

| Quyền | Dùng để |
|---|---|
| `public_profile` | Đăng nhập chủ tiệm |
| `pages_show_list` | Liệt kê Page để chọn khi kết nối |
| `pages_messaging` | Nhận và gửi tin Messenger (lõi của bot) |
| `pages_manage_metadata` | Đăng ký webhook `subscribed_apps` cho Page |
| `pages_read_engagement` | Đọc tên Page, lấy Page token, đọc bài đã đăng làm nguồn nội dung |
| `pages_manage_posts` | Đăng bài / ảnh / video lên Page theo lịch |
| `instagram_basic` | Lấy tài khoản Instagram gắn với Page |
| `instagram_manage_messages` | Nhận và gửi Instagram DM |
| `instagram_content_publish` | Đăng bài Instagram theo lịch (`/media`, `/media_publish`) |
| `business_management` | Chọn Page trong Business Manager (đang tắt mặc định qua `FB_REQUEST_BUSINESS_SCOPE`, vẫn nên giữ) |
| Business Asset User Profile Access | Đọc tên khách nhắn (`/{psid}?fields=first_name,last_name`) để hiện trong Hộp thư |

### B. Bị từ chối — xin lại sau khi sửa mục 1

| Quyền | Dùng để | Mã |
|---|---|---|
| **Human Agent** | Nhân viên trả lời khách trong 7 ngày sau tin cuối (Meta mặc định chỉ 24 giờ) | `messenger/human-agent.ts` gắn `messaging_type: MESSAGE_TAG, tag: HUMAN_AGENT` |

### C. Đang dùng trong mã nhưng **chưa xin** — nên xin cùng đợt này

| Quyền / tính năng | Dùng để | Mã | Ghi chú |
|---|---|---|---|
| `read_insights` | Báo cáo marketing hàng tháng: lượt xem, tiếp cận, tương tác của **Page** (`/{page}/insights`, trường `views`) | `marketing/connectors/meta-social.connector.ts` | Công tắc Render `FB_SCOPE_READ_INSIGHTS=1` mới hỏi trong hộp thoại |
| `instagram_manage_insights` | Báo cáo tháng: follower mới, nhân khẩu học, reach từng bài Instagram (`/{ig}/insights`, `/{media}/insights`) | cùng file | Công tắc `FB_SCOPE_INSIGHTS=1` |
| Instagram Public Content Access (feature) | Gợi ý xu hướng: tìm hashtag + bài nổi bật (`ig_hashtag_search`, `/{hashtag}/top_media`) | `content/trends/trend-feed.service.ts` | Không có → mục "Xu hướng Instagram" luôn trống |

Không cần xin: `ads_read` (báo cáo quảng cáo dùng token system-user của chính Lumio Agency, không qua tiệm), `pages_manage_engagement` / `instagram_manage_comments` (hệ thống không trả lời bình luận qua Graph API), `pages_read_user_content` (không đọc bài của người dùng).

### D. Thứ tự làm trên Meta (bạn tự thao tác, tôi không bấm hộ)

1. App Dashboard → **App Review → Permissions and Features**.
2. Bấm **Request advanced access** cho 3 mục ở bảng C (`read_insights`, `instagram_manage_insights`, Instagram Public Content Access).
3. Với Human Agent: bấm **Request again** trong màn "Review feedback", đính video mới có cảnh 24 giờ.
4. Nộp **một** submission gồm cả 4 mục, dán giải trình ở mục 3 và hướng dẫn ở mục 4 dưới đây.
5. Sau khi duyệt: bật `FB_SCOPE_READ_INSIGHTS=1` và `FB_SCOPE_INSIGHTS=1` trên Render (chưa duyệt mà bật → hộp thoại kết nối báo "Invalid Scopes" cho mọi tiệm). Tiệm đã kết nối trước đó phải **Kết nối lại Page** để token mới có quyền.

---

## 3. Giải trình dán vào form (tiếng Anh)

**Human Agent**

> Lumio Booking is a multi-tenant SaaS for nail salons. Customers message the salon's Facebook Page; an assistant answers immediately and books appointments. Some questions need a person (custom nail art quotes, complaints, reschedules), and salon staff are often busy with clients and reply later in the day or the next day — frequently after the 24-hour standard messaging window has closed. We use the HUMAN_AGENT tag exclusively for a reply typed by a salon employee from our dashboard inbox to a customer who messaged first, within 7 days of that message. The tag is never applied to automated or promotional messages: our server attaches it only when (a) the message is typed by a logged-in human user, (b) the customer's last message is older than 24 hours and newer than 7 days. Automated replies always use messaging_type RESPONSE inside the 24-hour window and are refused by our code outside it.

**read_insights**

> Salon owners receive a monthly marketing report inside Lumio showing how their own Facebook Page performed: page views, post reach and engagement. We call /{page-id}/insights with the Page token of the Page the owner connected. Data is displayed only to that salon's own users and is never shared across tenants or with third parties.

**instagram_manage_insights**

> The same monthly report includes the salon's own Instagram professional account: new followers, follower demographics and reach/views per post we published for them. We call /{ig-user-id}/insights and /{media-id}/insights for the account linked to the connected Page. Shown only to that salon's users.

**Instagram Public Content Access**

> Our content planner suggests trending nail-art hashtags and top public posts so the salon can plan its own posts. We call ig_hashtag_search and /{hashtag-id}/top_media on behalf of the salon's connected Instagram professional account, display the results read-only inside the planner, and do not store or republish the public posts.

---

## 4. Hướng dẫn cho người duyệt (dán vào "Instructions for reviewer")

> **Test account (demo salon):** email [ĐIỀN] · password [ĐIỀN] · URL https://lumiobooking.com
> **Test Page:** Lumio Booking — https://m.me/1213688201821751 (already connected, assistant enabled)
>
> **A. Automated reply (pages_messaging):**
> 1. From any Facebook account send: "Hi, what are your hours? Can I book a gel manicure this Saturday at 2pm?"
> 2. The assistant answers within seconds, asks for name and phone, and confirms the booking. Log in to the dashboard → Calendar to see the appointment.
>
> **B. Human Agent tag:**
> 1. Send a message to the Page and note the time.
> 2. Log in to the dashboard → Inbox → open your conversation. Inside 24 hours the composer shows a normal reply box; a reply here is sent as messaging_type RESPONSE.
> 3. Wait more than 24 hours (we can also point you to a conversation in the demo inbox that is already older than 24 hours). The composer now shows the banner "Past 24 hours — this goes out under Meta's human-agent tag". Type a reply and press Send: the message is delivered to the customer with tag HUMAN_AGENT. The assistant cannot send anything in this state — only a logged-in person can.
> 4. After 7 days the composer is locked and shows that the window has closed.
>
> **C. Insights:** dashboard → Marketing → Monthly report shows Page and Instagram reach/followers for the connected demo Page.
> **D. Instagram trends:** dashboard → Content → Trends shows hashtag suggestions from the connected Instagram account.

---

## 5. Kiểm tra 6 dòng trước khi nộp

- [ ] Nhắn từ tài khoản cá nhân vào Page test → bot trả lời < 10 giây (nếu không, xem bảng mục 1).
- [ ] Hộp thư demo có ít nhất 1 thread quá 24 giờ, chưa quá 7 ngày, để người duyệt thấy banner Human Agent.
- [ ] Không có thread nào của người duyệt đang bị khoá "Tôi nhận".
- [ ] Video mới có cảnh: khách nhắn → (24h sau) nhân viên trả lời từ Hộp thư → tin hiện bên Messenger khách.
- [ ] 4 mục nộp chung: Human Agent + read_insights + instagram_manage_insights + Instagram Public Content Access.
- [ ] Chưa bật `FB_SCOPE_INSIGHTS` / `FB_SCOPE_READ_INSIGHTS` trên Render cho tới khi duyệt xong.

---

## 6. Trạng thái 30/09/2026 — đã làm trên Meta Dashboard (Claude thao tác)

Submission nháp đang mở: https://developers.facebook.com/apps/1707103183956838/app-review/submissions/?submission_id=1781443799856109&business_id=835125502846476

Đã thêm 4 mục vào submission và điền xong phần giải trình (Allowed usage → Requests) cho cả 4: **Human Agent**, **Instagram Public Content Access**, **read_insights**, **instagram_manage_insights**. Đã viết lại toàn bộ **Reviewer instructions** (URL trực tiếp từng trang, vị trí nút "Connect with Facebook" / "+ Add page / reconnect", 15 bước test). Tài khoản demo (service.lumioagency.com@gmail.com) đã có sẵn trong ô test credentials.

Lý do IPCA bị từ chối 20/09: reviewer **không tìm thấy nút Facebook Login** (Platform Term 7.a) → đã ghi rõ đường đi trong cả giải trình và hướng dẫn.

### Còn lại bạn phải tự làm (tôi không bấm hộ)

1. **Video**: mỗi mục bấm "Get started" → "Upload file". Cần 4 video (có thể dùng chung 1 video nếu quay đủ 4 cảnh): đăng nhập → Messenger bot → nút "+ Add page / reconnect" mở hộp thoại Facebook → (Human Agent) Inbox, thread quá 24h, bấm "Take over", gõ trả lời, tin hiện bên Messenger khách → (Insights) Marketing report có số → (IPCA) Marketing plan & posts → Trends → chip Instagram.
2. Tick 4 ô "I agree…" trong 4 modal; tick 11 ô "I certify…" ở tab Renewal; xác nhận Data handling (đã điền sẵn, chỉ xem lại).
3. **read_insights đang 0 API call** → ô "Ensure you have performed required API test calls" chưa xanh, Meta sẽ không cho nộp mục này. Cách xử lý: trên Render bật `FB_SCOPE_READ_INSIGHTS=1` (quyền đã được thêm vào app nên không còn lỗi Invalid Scopes; với tài khoản admin app, Standard Access đủ để cấp), vào Messenger bot → "+ Add page / reconnect" để lấy token mới, rồi mở "Marketing report" 1–2 lần cho server gọi `/insights`. Chờ vài giờ, mở lại submission, ô sẽ xanh. Nếu không muốn chờ: bấm thùng rác cạnh read_insights để nộp 3 mục trước.
4. Trước khi Submit: nhắn thử vào Page test từ tài khoản cá nhân, bot phải trả lời; trong Inbox demo giữ 1 thread tên "META REVIEW - human agent test" có tin khách 1–6 ngày tuổi (đổi tên thread qua menu ⋯); không thread nào của reviewer đang bị khoá "Tôi nhận".
5. Bấm **Submit for review**.
