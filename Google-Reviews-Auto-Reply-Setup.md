# Google Review Auto‑Reply — Hướng dẫn xin quyền & cài đặt

Tính năng: hệ thống tự đọc review Google của tiệm, **soạn sẵn lời trả lời cho review 4–5★ (anh bấm duyệt 1 chạm)**, còn **review 1–3★ thì DỪNG, không tự trả lời, và gửi email báo ngay cho quản lý** để xử lý bằng tay.

> ⚠️ Cửa duy nhất: Google bắt **xin quyền truy cập API review** (một lần, cho cả nền tảng Lumio). Duyệt thường mất **~10 ngày**. Làm bước này càng sớm càng tốt. Phần code khung em đã xây xong, chờ được duyệt là chạy.

---

## Phần A — Điều kiện cần có trước

1. **Google Business Profile đã xác minh** (tiệm đã "claim" và xác minh trên Google Maps).
2. Hồ sơ đã **hoạt động 60+ ngày**.
3. **Website doanh nghiệp**: dùng `https://lumiobooking.com`.
4. Một tài khoản **Google Cloud** (dùng chính email quản lý nền tảng, ví dụ lumioagency).

---

## Phần B — Tạo dự án & bật API (Google Cloud Console)

1. Vào **console.cloud.google.com** → tạo project mới, ví dụ tên **"Lumio Reviews"**.
2. Vào **APIs & Services → Library**, tìm và bật (Enable) các API sau:
   - **Google My Business API** (đây là API chứa review v4 — mục quan trọng nhất).
   - **My Business Account Management API**.
   - **My Business Business Information API**.

> Lưu ý: "Google My Business API" mặc định **quota = 0** cho tới khi được duyệt (Phần C). Bật trước là đúng.

---

## Phần C — Nộp đơn xin quyền (bước quyết định)

1. Mở **Business Profile APIs → Prerequisites/Access request** (Google gọi là "Request access to the Business Profile APIs").
   - Link: https://developers.google.com/my-business/content/prereqs
2. Điền form yêu cầu, gồm:
   - **Project ID** (từ Phần B).
   - **Tên & website doanh nghiệp**: Lumio / `https://lumiobooking.com`.
   - **Use case** (mô tả mục đích) — gợi ý nội dung:
     > "Lumio Booking is a SaaS platform for nail salons. We help each salon owner reply to their own Google reviews from one dashboard: automatically drafting responses to positive reviews for one‑tap approval, and alerting the owner by email for negative reviews so a human can respond personally. Each salon authorizes access to their own Business Profile via OAuth (business.manage)."
3. Gửi và **chờ Google duyệt (~10 ngày)**. Khi quota được nâng lên (ví dụ 300 QPM) là đã được duyệt.

---

## Phần D — Màn hình OAuth & OAuth Client

Làm song song trong lúc chờ duyệt.

1. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Điền tên app "Lumio", email hỗ trợ, domain `lumiobooking.com`.
   - **Scopes**: thêm `https://www.googleapis.com/auth/business.manage`.
   - Publishing status: đưa lên **In production** (để token không hết hạn sau 7 ngày như chế độ Testing).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URI** — dán CHÍNH XÁC:
     ```
     https://lumio-api-uqm6.onrender.com/api/google-reviews/callback
     ```
     (nếu domain API của anh khác thì thay cho đúng — đây là địa chỉ backend, không phải web).
   - Bấm Create → copy **Client ID** và **Client secret**.
3. **Trên Render** (dịch vụ API), thêm 2 biến môi trường rồi Save (deploy lại):
   - `GBP_CLIENT_ID` = Client ID vừa tạo
   - `GBP_CLIENT_SECRET` = Client secret vừa tạo

> Đây là **một** OAuth client dùng chung cho cả nền tảng. Mỗi tiệm sẽ tự bấm "Connect" để cấp quyền hồ sơ Google **của riêng họ** — không ai thấy dữ liệu của ai.

---

## Phần E — Kết nối trong Lumio (sau khi được duyệt)

1. Đăng nhập tiệm → **Reviews replies** (mục em sẽ thêm ở bước giao diện kế tiếp).
2. Bấm **Connect Google** → đăng nhập Google chủ tiệm → đồng ý.
3. Chọn đúng **địa điểm (location)** của tiệm.
4. Đặt cấu hình:
   - Ngưỡng: **1–3★ báo quản lý, 4–5★ soạn nháp chờ duyệt** (mặc định như anh chọn).
   - **Email nhận cảnh báo** review xấu.
5. Bật tính năng. Xong — hệ thống bắt đầu đồng bộ review.

---

## Cách hoạt động (tóm tắt)

| Review | Hệ thống làm gì |
|---|---|
| **5★ / 4★** | Soạn sẵn lời cảm ơn (mỗi lần một câu khác nhau) → anh bấm **Duyệt** 1 chạm → đăng lên Google |
| **4–5★ nhưng lời than phiền** | Tự nhận diện → chuyển sang "cần xử lý", không tự trả lời |
| **3★** | Không tự trả lời → **email báo quản lý** |
| **1★ / 2★** | Không tự trả lời → **email báo quản lý ngay** kèm nội dung review |

- Không bao giờ tự trả lời máy móc review xấu (đúng như anh muốn).
- Mỗi tiệm tách biệt hoàn toàn (token, review, email báo riêng).
- Không xoá được review xấu qua API (Google không cho) — hệ thống báo để anh xử lý tay.

---

## Lưu ý

- Không tạo/khuyến khích review giả — vi phạm chính sách Google, có thể bị khóa.
- Nếu chế độ OAuth để **Testing** thì refresh token hết hạn sau 7 ngày → nhớ đưa lên **In production** (Phần D.1).
- Nếu chưa được duyệt mà bấm Sync, hệ thống sẽ báo lỗi quyền — chờ Google duyệt xong là hết.

---

### Nguồn tham khảo (Google Developers)
- Work with review data: https://developers.google.com/my-business/content/review-data
- reviews.updateReply (trả lời review): https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply
- Prerequisites / xin quyền: https://developers.google.com/my-business/content/prereqs
- OAuth cho Business Profile: https://developers.google.com/my-business/content/implement-oauth
- Real‑time notifications (nâng cao, cho sau): https://developers.google.com/my-business/content/notification-setup
