# Ảnh màn hình cho store

## Kích thước bắt buộc

**App Store** (chỉ nộp iPhone — tắt iPad trong Xcode: target App → General → Supported Destinations bỏ iPad):
- iPhone 6.9" — **1320 × 2868** (bắt buộc; 3–10 ảnh). Apple tự co cho các cỡ nhỏ hơn.
- (tuỳ chọn) iPhone 6.5" — 1284 × 2778.

**Google Play**:
- Điện thoại: tối thiểu 2, tối đa 8; tỉ lệ 9:16, mỗi cạnh 320–3840 px → dùng **1080 × 1920** hoặc **1320 × 2868** như iOS.
- Feature graphic: **1024 × 500** — đã có ở `assets/play-feature-1024x500.png`.
- Tablet 7"/10": không bắt buộc nếu chỉ chọn Phone.

## 6 màn hình cần chụp (thứ tự này)

Ảnh 1–3 là thứ người ta thấy mà không cuộn → phải nói được app làm gì.

| # | Màn hình | Chú thích in phía trên ảnh (EN) | (VI) |
|---|---|---|---|
| 1 | Lịch hôm nay (`/salon/calendar`, ngày có 6–8 lịch, nhiều thợ) | **Your whole day, by technician** | **Cả ngày, theo từng thợ** |
| 2 | Inbox với hội thoại AI đang đặt lịch (`/salon/messenger`) | **AI books for you on Messenger & Instagram** | **AI đặt lịch thay bạn trên Messenger** |
| 3 | Queue bài đăng tháng (`/salon/content?tab=queue`, view calendar) | **A month of social posts, ready to approve** | **Cả tháng bài đăng, chỉ việc duyệt** |
| 4 | Walk-in queue (`/salon/walkins`) | **Walk-ins seated in seconds** | **Khách walk-in xếp chỗ trong vài giây** |
| 5 | Hồ sơ khách (`/salon/customers/<id>`) | **Every client, every visit, every photo** | **Mỗi khách, mỗi lần ghé, mỗi tấm ảnh** |
| 6 | POS thanh toán có tip (`/salon/pos`) | **Checkout with tips and receipts** | **Thanh toán, tip, biên lai** |

Dùng **tiệm demo** (dữ liệu giả, tên khách giả) — không chụp tiệm khách thật.

## Cách chụp (Chrome trên Mac/Windows, không cần điện thoại)

1. Đăng nhập tiệm demo tại `https://lumiobooking.com/salon`.
2. F12 → bật Device toolbar (Ctrl/Cmd+Shift+M) → Dimensions: **Responsive**, nhập `440 × 956`, DPR = **3**
   (→ ảnh 1320 × 2868). Zoom 100 %.
3. Mở đúng màn hình, đợi tải xong, ẩn thanh cuộn.
4. Menu ⋮ của DevTools → **Capture screenshot** (không phải full size). File PNG ra đúng 1320 × 2868.
5. Lặp cho 6 màn hình, hai ngôn ngữ nếu muốn (chuyển EN/VI ở góc app).

Ghép chú thích: mở `tools/screenshot-frame.html` (bên dưới), kéo ảnh vào, gõ chú thích, bấm Tải về —
ra ảnh cùng kích thước có dải chữ trên nền tối và viền bo. Hoặc dùng Figma/Canva với khổ 1320 × 2868.

## Video preview (tuỳ chọn, nên có với Apple)

15–30 giây, quay màn hình iPhone (Cài đặt → Trung tâm điều khiển → Ghi màn hình), cắt bằng iMovie,
xuất đúng 886 × 1920 (6.9") — Apple tự nhận. Không nhạc có bản quyền, không tay/người.
