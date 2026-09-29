# TikTok Direct Post — Bộ hồ sơ xin duyệt (audit)

Mục đích: gỡ giới hạn "chỉ đăng riêng tư" để Lumio đăng video CÔNG KHAI lên TikTok của tiệm.
Nơi nộp: TikTok for Developers → app **Lumio Booking** → Products → **Content Posting API** → dòng **Direct Post** → bấm **Apply**.

> "Live" (app review) ≠ Direct Post audit. App đã Live từ 28/09/2026; audit là bước riêng.

---

## 1. Trước khi quay video (5 phút)

- [ ] **Chuyển giao diện Lumio sang tiếng Anh (EN)** — người duyệt của TikTok không đọc tiếng Việt.
- [ ] **Verify domains (BẮT BUỘC)**: Content Posting API → Verify domains → thêm URL prefix `https://media.lumiobooking.com/` (làm theo hướng dẫn xác minh của TikTok). Quy định số 38–41 của TikTok: video đã nằm trên máy chủ thì phải dùng PULL_FROM_URL; chưa verify thì hệ thống phải tải file lên (FILE_UPLOAD) — người duyệt có thể coi là sai quy định.
- [ ] Dùng tài khoản TikTok **của anh** (không cần tài khoản khách) và một **tiệm demo** trên Lumio, đăng nhập bằng tài khoản CHỦ TIỆM của tiệm demo đó (vai trò Salon Admin) — KHÔNG vào bằng Lumio Support.
- [ ] Video đăng thử phải là **video anh tự quay** (móng làm tại tiệm, không logo/watermark, không nhạc có bản quyền) — TikTok chỉ duyệt nội dung gốc; không dùng video lấy từ người khác.

- [ ] Deploy bản mới nhất lên lumiobooking.com.
- [ ] Chuẩn bị 1 tài khoản TikTok test (không phải tài khoản khách). Trong lúc CHƯA duyệt, bật **Settings → Privacy → Private account** cho tài khoản này (bắt buộc, không thì TikTok từ chối đăng).
- [ ] Một video MP4 ngắn (≤ 60 giây, dọc 9:16), không có nhạc bản quyền.
- [ ] Đăng nhập Lumio bằng tài khoản **chủ tiệm** (Salon Admin) của một tiệm demo — không dùng phiên Lumio Support, để video thấy rõ CHỦ TIỆM tự kết nối.
- [ ] Nếu TikTok app đang kết nối sẵn với tiệm demo: bấm Ngắt kết nối trước, để quay được cả bước đăng nhập + cấp quyền.
- [ ] Quay màn hình có tiếng nói hoặc phụ đề tiếng Anh (reviewer không có bối cảnh — phải nói họ đang xem gì).

## 2. Kịch bản quay (≈ 2–3 phút, quay liền một mạch)

| # | Làm gì trên màn hình | Nói / phụ đề (English) |
|---|---|---|
| 1 | Mở lumiobooking.com, đăng nhập tài khoản chủ tiệm. | "Lumio Booking is a scheduling and marketing platform for nail salons. This is the salon owner logged in to their own salon." |
| 2 | Vào **Kết nối kênh social** → bấm **Kết nối TikTok →**. | "The owner connects their own TikTok account. Lumio never sees their password." |
| 3 | Màn hình đăng nhập TikTok → đăng nhập → màn hình **cấp quyền** (user.info.basic, video.publish) → Allow. | "TikTok's consent screen shows exactly the permissions requested: basic profile and video publishing. The owner approves." |
| 4 | Quay lại Lumio, thẻ TikTok hiện **tên tài khoản + avatar** (Đã kết nối). | "The connected account is shown by nickname, so the owner knows where content will go." |
| 5 | Vào **Kế hoạch & bài đăng → Lịch đăng bài** → tạo bài mới → chọn kênh **TikTok** → tải video lên. | "The owner creates a post and uploads a video." |
| 6 | Dừng ở khung TikTok của bài: chỉ vào **tên tài khoản (creator nickname)** và **thời lượng tối đa**. | "We call creator_info every time this screen opens: the creator's nickname and the maximum video duration come from TikTok." |
| 7 | Mở ô **Quyền riêng tư**: cho thấy KHÔNG có giá trị mặc định; danh sách lấy từ privacy_level_options. Chọn **Only me** (vì chưa duyệt). | "Privacy has no default. The options come from privacy_level_options. The user must choose." |
| 8 | Chỉ vào **Comment / Duet / Stitch**: tất cả đều TẮT sẵn; tick Comment. (Nếu tài khoản tắt Duet/Stitch trong app → ô bị mờ.) | "Interaction settings are all off by default, and greyed out if the creator disabled them in TikTok." |
| 9 | Bật **Disclose commercial content** → hiện dòng "You need to indicate if your content promotes yourself, a third party, or both" và nút đăng bị khóa → chọn **Your brand** → hiện "Your video will be labeled as Promotional content". Chỉ vào **Branded content** đang bị mờ vì đã chọn Only me, rê chuột thấy "Branded content visibility cannot be set to private". Sau đó TẮT lại disclosure. | "Commercial content disclosure is off by default. When it is on, the user must choose at least one option before publishing. Because this post is private, Branded content is disabled: branded content visibility cannot be set to private." |
| 10 | Chỉ vào **xem trước video** và dòng **"By posting, you agree to TikTok's Music Usage Confirmation"**. | "The user sees a preview and TikTok's required declaration before posting." |
| 11 | Bấm **Đăng lên ngay**. | "The user explicitly presses Post. Nothing is posted without this action." |
| 12 | Cho thấy trạng thái đang xử lý → **Đã đăng**. | "We poll the publish status API and show the result." |
| 13 | Mở app TikTok / tiktok.com của tài khoản test → video nằm trên profile. | "The video is now on the creator's profile." |
| 14 | (Tuỳ chọn) Vào Kết nối kênh social → **Ngắt kết nối TikTok**. | "The owner can disconnect at any time." |

Xuất video MP4 (≤ 50 MB nếu form giới hạn), hoặc để link Google Drive / YouTube không công khai.

## 3. Câu trả lời điền form (copy – dán)

**App name:** Lumio Booking
**Website:** https://lumiobooking.com
**Privacy Policy / Terms:** (dán link trang chính sách và điều khoản của Lumio)

**Describe how your app uses Direct Post:**
> Lumio Booking is a booking and marketing platform used by independent nail and beauty salons in the US, Canada, Australia and Vietnam. A salon owner connects their OWN TikTok account through TikTok Login Kit and can then publish short videos of their work (nail designs, salon updates) to that account from Lumio's post composer, either immediately or at a time they schedule. Posts are written inside the salon's own Lumio account by the owner or by people the owner lets work in that account (their staff, or Lumio's support team when the salon asks for help with its social media). The owner sees every scheduled post in their account and can edit, hold or cancel it before it goes out. Lumio only posts to a TikTok account its owner connected, only as a result of a user pressing Post or scheduling a post, and does not add watermarks, logos or overlays to the video.

**Who are your users?**
> Owners and staff of small beauty businesses (nail salons, spas) who manage their own social media. Each salon is a separate tenant; a TikTok connection belongs to exactly one salon and is only used for that salon's posts.

**How do you comply with the Direct Post UX guidelines?**
> - We call creator_info/query each time the TikTok post panel is opened and display the creator's nickname, respect max_video_post_duration_sec, and build the privacy options from privacy_level_options.
> - Privacy level has no default value; the user must select one.
> - Comment, Duet and Stitch are unchecked by default and disabled when the creator has turned them off.
> - Commercial content disclosure is off by default; when on, the user must choose "Your brand" and/or "Branded content", we show the "Promotional content" / "Paid partnership" label, block publishing until a choice is made, and do not allow Branded content with "Only me".
> - We show a preview of the video and the declaration "By posting, you agree to TikTok's Music Usage Confirmation" (and the Branded Content Policy when applicable) before the user presses Post.
> - After posting we poll publish/status/fetch and show the user the processing result.
> - Users can disconnect TikTok at any time from the Social channels screen; on disconnect Lumio revokes the token with TikTok and deletes it.

**Please list the API response data fields that your API client will save in its database** (đã đối chiếu với code):
> Lumio stores only the following TikTok fields, on our server, per salon (each salon has at most one TikTok connection):
> 1. OAuth token response (/v2/oauth/token/): open_id, access_token, refresh_token, and expires_in / refresh_expires_in (saved as expiry times). The scope is checked for video.publish but not stored. Tokens stay on the server and are never sent to the browser.
> 2. user/info (fields=open_id,display_name,avatar_url): display_name and avatar_url, to show the owner which account is connected.
> 3. creator_info/query: creator_nickname, creator_username, creator_avatar_url, privacy_level_options, comment_disabled, duet_disabled, stitch_disabled, max_video_post_duration_sec. These build the post form and are refreshed each time the TikTok post panel is opened.
> 4. Publishing: publish_id (from video/init) and publicaly_available_post_id (from publish/status/fetch), saved on the salon's post so the owner can open the published video. If publishing fails, the fail_reason is saved as the error message shown to the user.
> We do not store videos lists, followers, likes, comments or any other TikTok user data. When the owner disconnects, Lumio revokes the token with TikTok (/v2/oauth/revoke/) and deletes the tokens, open_id, avatar and creator info; only the display name and username are kept so the salon's post history shows which account earlier posts went to.

**Scopes used:** user.info.basic, video.publish (không xin thêm scope nào khác).

**Demo video:** (link video ở mục 2)

## 4. Việc nên làm thêm (không bắt buộc)

- (Đã chuyển lên mục 1 — Verify domains là bắt buộc trước khi quay.)
- Sau khi được duyệt: tắt "Private account" của tài khoản test; bài mới chọn Công khai là lên công khai. Bài đăng TRONG lúc chưa duyệt vẫn giữ riêng tư.
- Nếu bị từ chối: chụp lý do gửi đội Lumio — thường là thiếu một bước trong video (ví dụ không cho thấy màn hình cấp quyền hoặc trạng thái sau khi đăng).
