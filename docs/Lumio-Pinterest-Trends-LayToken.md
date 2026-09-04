# Lấy token Pinterest Trends cho Lumio

Bảng Xu hướng có 4 nguồn: YouTube, Instagram, Google, Pinterest. File này chỉ nói về Pinterest.

---

## Trước khi bắt đầu — đọc cái này

**Pinterest Trends không phủ Việt Nam.** Pinterest chỉ trả dữ liệu xu hướng cho một số nước
(Mỹ, Canada, Anh, Đức, Pháp…), không có VN. Hệ thống đã biết điều này: trong
`apps/api/src/content/trends/trend-feed.ts` thị trường VN đặt `pinterestRegion: null`,
nên tiệm Việt Nam sẽ luôn thấy nguồn Pinterest ở trạng thái "chưa bật" dù token có đúng.

**Vậy token này để làm gì:** cho tiệm ở **Mỹ và Canada**. Nếu hiện tại chỉ chạy tiệm Việt Nam
thì làm bước này chưa mang lại gì — để sau cũng được.

---

## Bước 1 — Tài khoản phải là business

Pinterest yêu cầu tài khoản **business** để quản trị app, và email phải đã xác minh.
Tài khoản cá nhân chuyển sang business được, miễn phí, trong phần cài đặt Pinterest.

## Bước 2 — Xin quyền dùng API (mất vài ngày làm việc)

1. Vào **https://developers.pinterest.com/apps/**
2. Đồng ý Developer Terms of Service
3. Bấm **Connect app**, điền form mô tả app dùng để làm gì
4. Gửi đi — đây là xin **trial access**. Pinterest duyệt trong vài ngày làm việc,
   trả lời qua email. Có thể bị từ chối; mô tả rõ mục đích thì dễ được duyệt hơn.

Chưa được duyệt thì chưa có gì để lấy. Không có đường tắt.

### Nội dung điền form (đã dùng thật, 09/2026)

| Ô | Điền |
|---|---|
| Tên ứng dụng | `Lumio Agency — Trend Insights` |
| Tên công ty | `Lumio Agency` |
| Trang web công ty hoặc liên kết ứng dụng | `https://lumiobooking.com` |
| Liên kết đến Chính sách quyền riêng tư | `https://lumiobooking.com/privacy` |
| Mục đích của nhà phát triển | **Trải nghiệm người tiêu dùng** (doanh nghiệp, người bán… ở quy mô lớn) |
| Các trường hợp sử dụng | chỉ **Khác**, kèm mô tả bên dưới |
| Đọc Ghim và/hoặc Dữ liệu bảng | **Không** |

Tên ứng dụng **bắt buộc chứa tên công ty** — Pinterest ghi rõ ở dưới ô đó. Đặt lệch nhau là bị chặn.

**Mục đích ứng dụng:**

```
Lumio Agency operates Lumio Booking (lumiobooking.com), a booking and
marketing platform for beauty salons — nail, hair, lash, brow and spa —
in the United States and Canada.

We want to read trending keywords for the beauty category and show them
inside each salon's content planning screen, so a small salon owner can
decide what to photograph and post this week based on what people are
actually searching for on Pinterest instead of guessing.

Usage is read-only. We call GET /v5/trends/keywords/{region}/top/growing
once a day per region and cache the result for 24 hours — a few hundred
calls per day at most. We do not create or edit pins, do not read or
store any Pinterest user's personal data, and do not scrape pinterest.com.

Requested scopes: ads:read, user_accounts:read
```

**Trường hợp sử dụng → Khác, ghi rõ:**

```
Trends research only. We read the Pinterest Trends keyword endpoint
(GET /v5/trends/keywords/{region}/top/growing) once a day per region and
display the growing keywords to beauty-salon owners inside our platform,
so they can plan what to photograph and post that week. We do not create
pins, do not run ads, and do not access any Pinterest user's account data.
```

### Ba chỗ dễ bị từ chối

Hồ sơ bị đánh trượt phần lớn vì **tự mâu thuẫn**, không phải vì mô tả sơ sài:

1. **Tick "Lên lịch & tạo Ghim"** trong khi mô tả ghi read-only. Ô đó nghĩa là đăng bài, đòi `pins:write`.
2. **Chọn "Có, của tôi"** ở ô Đọc Ghim/Bảng trong khi mô tả ghi không đọc pin. Phải chọn **Không**.
3. **Chọn "Bộ kết nối AI hoặc MCP"** ở mục đích nhà phát triển. Lumio không phải MCP; chọn sai là bị đẩy sang luồng duyệt khắt khe hơn.

Xin đúng thứ mình dùng, không xin dư. `pins:write` không dùng mà xin là lý do từ chối.

## Bước 3 — Lấy App ID và App secret

Được duyệt rồi, quay lại **My apps** → app vừa tạo. Hai giá trị cần lấy:

| Trên Pinterest | Đặt vào biến |
|---|---|
| App ID | `PINTEREST_APP_ID` |
| App secret | `PINTEREST_APP_SECRET` |

## Bước 4 — Khai Redirect URI

Trong app: tab **Configure** → mục **Redirect URIs** → thêm một URI → **Add**.

URI này phải **khớp từng ký tự** với cái dùng ở bước 5, sai một dấu `/` là hỏng.
Nếu không có chỗ nào để hứng, dùng tạm `https://lumiobooking.com/` — chỉ cần đọc được
thanh địa chỉ sau khi Pinterest chuyển hướng về.

## Bước 5 — Đổi lấy refresh token

**5a.** Mở link này trong trình duyệt (thay `APP_ID` và `REDIRECT_URI` của mình):

```
https://www.pinterest.com/oauth/?client_id=APP_ID&redirect_uri=REDIRECT_URI&response_type=code&scope=ads:read,user_accounts:read&state=lumio
```

Đồng ý cấp quyền. Pinterest chuyển hướng về URI đã khai, trên thanh địa chỉ có `?code=...`.
**Chép đoạn `code` đó** — nó chỉ dùng được một lần và hết hạn rất nhanh.

**5b.** Đổi `code` lấy token. Chạy trên máy (thay 4 chỗ IN HOA):

```bash
curl -X POST https://api.pinterest.com/v5/oauth/token \
  -u "APP_ID:APP_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=CODE_VUA_CHEP" \
  -d "redirect_uri=REDIRECT_URI"
```

Kết quả trả về có `refresh_token` → đặt vào `PINTEREST_REFRESH_TOKEN`.

## Bước 6 — Đặt biến trên Render

Ba biến, trên service API:

```
PINTEREST_APP_ID=...
PINTEREST_APP_SECRET=...
PINTEREST_REFRESH_TOKEN=...
```

Không cần `PINTEREST_ACCESS_TOKEN` — hệ thống tự đổi access token từ refresh token,
mỗi giờ nhiều nhất một lần. Deploy lại, mở tab Xu hướng của một tiệm Mỹ để kiểm.

---

## Khi có lỗi

| Thấy gì | Nghĩa là |
|---|---|
| Nguồn Pinterest "chưa bật" ở tiệm VN | Đúng như thiết kế — Pinterest Trends không có VN |
| Nguồn "chưa bật" ở tiệm Mỹ | Thiếu biến, hoặc chưa deploy lại |
| `pinterest 401` | Refresh token sai hoặc đã hết hạn — cấp lại từ bước 5 |
| `pinterest 403` | Thiếu scope. Cấp lại ở bước 5a, thêm scope (`ads:read` là scope nhóm insights) |
| `pinterest 429` | Chạm giới hạn gọi của Pinterest, tự hết sau ít lâu |

Lỗi được ghi thẳng vào bảng Xu hướng bên cạnh dữ liệu hôm trước, không im lặng.

## Việc còn nợ

Refresh token của Pinterest **có hạn** (tài liệu Pinterest ghi 60 ngày, gia hạn được).
Code hiện tại đổi access token từ refresh token nhưng **chưa tự xoay vòng refresh token**,
nên tới hạn sẽ phải cấp lại tay theo bước 5. Sửa được — chưa làm vì chưa có token thật để thử.
