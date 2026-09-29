# Meta App Review — xin 1 lần các quyền còn thiếu (Lumio Booking)

Danh sách này lập từ việc rà toàn bộ code: mọi chỗ Lumio gọi API của Meta, và mỗi chỗ cần quyền gì.

## A. Đã được duyệt — KHÔNG xin lại

pages_show_list · pages_messaging · pages_manage_metadata · pages_read_engagement · pages_manage_posts · instagram_basic · instagram_manage_messages · instagram_content_publish · business_management · public_profile · Business Asset User Profile Access

Các quyền này vẫn chạy bình thường trong lúc Meta xét yêu cầu mới.

## B. Cần xin — gộp vào MỘT lần gửi

| # | Quyền / tính năng | Dùng cho | Bắt buộc? |
|---|---|---|---|
| 1 | **instagram_manage_insights** | Báo cáo tháng: Reach, Views, follow mới, số liệu từng bài, nhân khẩu học Instagram | Bắt buộc |
| 2 | **read_insights** | Báo cáo tháng: số liệu Fanpage (lượt xem trang, follow mới) | Bắt buộc |
| 3 | **Instagram Public Content Access** (feature) | Tab xu hướng: tìm bài hot theo hashtag (ig_hashtag_search) | Nên xin |
| 4 | **ads_read** | Mục "Quảng cáo" trong báo cáo (chi phí, reach, click) | Chỉ xin nếu quay được video có tài khoản quảng cáo đang có chi tiêu |

⚠️ KHÔNG chọn `instagram_business_manage_insights` (có chữ **business**). Quyền đó dành cho kiểu "đăng nhập bằng Instagram", Lumio không dùng. Lumio kết nối Instagram qua Fanpage (Facebook Login), nên cần `instagram_manage_insights`.

Không xin các quyền khác như bình luận hay lead ads: Lumio chưa có tính năng dùng đến, Meta sẽ từ chối vì không có video chứng minh.

## C. Bấm ở đâu

> **Trạng thái "Ready for testing" + cột số 0** = quyền đã nằm trong app nhưng app CHƯA gọi API với quyền này lần nào. Meta chỉ cho gửi duyệt (Actions → Request advanced access) sau khi có ít nhất 1 lần gọi thành công; con số có thể mất tới 24–48 giờ mới cập nhật. Vì vậy phải làm mục E (kết nối lại + Sync all bằng tài khoản Admin của app) TRƯỚC, rồi mới gửi duyệt.
> Nếu không tìm thấy `read_insights` hoặc `Instagram Public Content Access` thì bỏ qua — chỉ `instagram_manage_insights` là bắt buộc để Instagram có số liệu.

1. Menu trái → **Review** → **Permissions and features**.
2. Ô tìm kiếm: gõ lần lượt `instagram_manage_insights`, `read_insights`, `Instagram Public Content Access` (và `ads_read` nếu xin). Ở mỗi dòng bấm **Request advanced access** hoặc **Add to App Review**.
3. Vào **Review → App Review / Requests**. Cả 3–4 dòng phải nằm trong **cùng một** yêu cầu. Điền phần mô tả (mục D) và tải video (mục E) cho từng dòng → anh tự tick các ô cam kết → **Submit**.

## D. Mô tả (copy – dán, tiếng Anh)

**instagram_manage_insights**
> Lumio Booking is a booking and marketing platform for independent nail and beauty salons. A salon owner connects their Facebook Page and the Instagram professional account linked to it. Every month Lumio builds a marketing report for that salon: Instagram reach, views, total interactions, new followers, follower demographics, and a per-post breakdown (reach, views, saves, shares) of the posts published that month. We read these insights only for the Instagram account the salon connected, only to show that salon its own report inside its Lumio account (and as a PDF/Word file it can download). The data is never shared with other salons or third parties, and is not used for advertising.

**read_insights**
> The same monthly marketing report includes the salon's Facebook Page performance: page views, post views and new follows for the month, compared with the previous month. read_insights lets us read these Page Insights for the Page the salon connected. They are shown only to that salon in its own report and are never shared with other salons or third parties.

**Instagram Public Content Access**
> In Lumio's content planner, a salon sees trending public nail posts for hashtags relevant to its services (for example #naildesign, #chromenails), so it can plan its own original posts. We call ig_hashtag_search and the hashtag's top_media edge using the salon's connected Instagram professional account, and show the public post's image, caption, like count and permalink with a link back to Instagram. We do not store other users' personal data, do not repost their content, and only show public media returned by the Hashtag Search API.

**ads_read** (nếu xin)
> The salon's monthly marketing report includes its Facebook/Instagram ad results: spend, impressions, reach and clicks for the month, read from the ad account the salon's marketing is run from. ads_read is used only to read these account-level insights and show them to that salon in its own report. We do not create or edit ads with this permission.

## E. Kịch bản video (mỗi quyền 1 video, 1–2 phút, giao diện tiếng Anh)

Chuẩn bị: làm xong mục C bước 2 (quyền đã nằm trong app), rồi mới bật `FB_SCOPE_INSIGHTS` = `true` trên Render (anh tự gõ) và deploy bản mới. Nếu chưa bật, hộp thoại của Meta sẽ không hiện quyền mới và video không chứng minh được. Sau đó đăng nhập Lumio bằng tài khoản có vai trò trong app Meta (Admin/Tester), vào một tiệm có Fanpage + Instagram thật.

**Video 1 — instagram_manage_insights + read_insights** (có thể dùng chung 1 video cho cả 2 quyền, tải lên ở cả 2 dòng)
1. Vào kết nối kênh → **Connect Facebook** → hộp thoại Meta hiện đủ quyền, trong đó có quyền xem thống kê → **Continue/Allow**.
2. Quay lại Lumio, thẻ kết nối hiện tên Fanpage + @instagram.
3. Vào **Marketing → Monthly report** → bấm **Sync all**.
4. Cuộn chậm: chỉ vào số Reach / Views / New followers của **Instagram** (instagram_manage_insights) và số của **Facebook** (read_insights), rồi phần top bài theo lượt xem.
5. Bấm tải báo cáo PDF/Word để thấy số liệu chỉ nằm trong báo cáo của tiệm.

**Video 2 — Instagram Public Content Access**
1. Vào **Content → Trends**, chọn một hashtag về nail.
2. Danh sách bài công khai hiện ra (ảnh, caption, like, link) → bấm một bài để mở trên Instagram.

**Video 3 — ads_read** (nếu xin)
1. Vào báo cáo tháng của tiệm có chạy quảng cáo → mục **Ads** hiện chi phí, reach, click.

## F. Sau khi Meta duyệt

1. (`FB_SCOPE_INSIGHTS` đã bật từ lúc quay video, giữ nguyên.)
2. Các tiệm kết nối lại Facebook một lần.
3. Báo cáo → **Sync all**.

Trong lúc chờ duyệt: tài khoản có vai trò Tester/Admin trong app kết nối cho tiệm thì vẫn kéo được số liệu ngay (xem hướng dẫn trước).
