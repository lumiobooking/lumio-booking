# Ảnh màn hình cho store

## Bộ ảnh đã làm sẵn — `docs/app-store/screenshots/`

Chụp từ đúng giao diện thật của app (cùng component), dữ liệu tiệm demo "Lumio Demo Nails" (tên khách, số
`555-01xx`, email `@example.com` đều giả), tiếng Anh, 1:10 PM giờ Chicago. Đúng kích thước Apple yêu cầu,
kéo thả thẳng vào App Store Connect theo thứ tự số.

**iPhone 6.9" — 1320 × 2868** (ô "iPhone 6.9\" Display"):

| # | File | Chú thích |
|---|---|---|
| 1 | `iphone-1-calendar.png` | Your whole day, by technician |
| 2 | `iphone-2-confirm.png` | Confirm new bookings in one tap |
| 3 | `iphone-3-checkin.png` | Clients check in from their phone |
| 4 | `iphone-4-returning.png` | Regulars check in in seconds |
| 5 | `iphone-5-solo.png` | Made for solo techs too |

**iPad 13" — 2752 × 2064, ngang** (ô "iPad 13\" Display"):

| # | File | Chú thích |
|---|---|---|
| 1 | `ipad-1-calendar.png` | Your whole salon on one calendar |
| 2 | `ipad-2-confirm.png` | Confirm online bookings in one tap |
| 3 | `ipad-3-kiosk.png` | A check-in kiosk for your front desk |
| 4 | `ipad-4-returning.png` | Regulars check in in seconds |
| 5 | `ipad-5-display.png` | A customer display at checkout |

Apple tự co ảnh 6.9" cho các iPhone nhỏ hơn và ảnh 13" cho các iPad nhỏ hơn — không cần bộ khác.

**Google Play** dùng lại 5 ảnh iPhone (mỗi cạnh ≤ 3840 px: hợp lệ). Feature graphic 1024 × 500:
`assets/play-feature-1024x500.png`.

## Khi giao diện đổi nhiều — chụp lại

Ảnh phải giống app thật (Apple 2.3.3). Đổi giao diện lịch, check-in hay màn hình khách thì chụp lại:

1. Đăng nhập tiệm demo tại `https://lumiobooking.com/salon` (tạo tiệm demo: `listing.md` mục D — nút
   "Load demo data" trong Super Admin), chuyển ngôn ngữ sang English.
2. Chrome → F12 → Device toolbar (Ctrl/Cmd+Shift+M) → Responsive:
   - iPhone: `440 × 956`, DPR **3** → 1320 × 2868
   - iPad: `1376 × 1032`, DPR **2** → 2752 × 2064
3. Mở màn hình, đợi tải xong → menu ⋮ của DevTools → **Capture screenshot**.
4. Ghép chú thích bằng Figma/Canva cùng khổ (nền tím đậm, chữ trắng Poppins Bold, ảnh bo góc phía dưới) —
   hoặc nhờ Claude ghép lại như bộ hiện tại.

Không chụp tiệm khách thật. Không để lộ số điện thoại/email thật.

## Video preview (tuỳ chọn)

15–30 giây quay màn hình trên iPhone/iPad (Trung tâm điều khiển → Ghi màn hình), cắt gọn. Không nhạc có
bản quyền.
