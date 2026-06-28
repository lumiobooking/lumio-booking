# Lumio — Cầu nối in tại quầy (Print Agent)

Chương trình nhỏ chạy trên **máy lễ tân** (máy đang cắm máy in). Khi nhân viên bấm
**In** trên điện thoại (có bật "In tại quầy lễ tân" ở màn Bán hàng), hóa đơn sẽ
**tự động in ra máy in ở quầy**.

Mỗi tiệm chỉ thấy lệnh in của tiệm mình (xác thực bằng **API key riêng** của tiệm).

---

## Cài đặt (làm 1 lần, ~5 phút)

**1. Cài Node.js (18 trở lên)** trên máy lễ tân: https://nodejs.org → tải bản LTS → cài.

**2. Copy cả thư mục `print-agent`** này vào máy lễ tân (ví dụ: `C:\lumio-print-agent`).

**3. Lấy API key của tiệm:**
- Vào app Lumio bằng tài khoản chủ (Salon Admin) → mục **Tích hợp (Integrations)**.
- Tạo một **API key** mới → bấm **Copy** (chỉ hiện 1 lần, nhớ lưu lại).

**4. Tạo file cấu hình:**
- Copy `config.example.json` → đổi tên thành **`config.json`**.
- Mở `config.json` bằng Notepad và điền:
  - `apiBase`: địa chỉ máy chủ + `/api` (giống địa chỉ app của bạn, ví dụ `https://lumio-api-xxxx.onrender.com/api`).
  - `apiKey`: dán API key vừa copy.
  - `printer`: **tên máy in trong Windows** (xem ở *Settings → Printers & scanners*). Để **trống `""`** nếu muốn dùng máy in mặc định.
  - `pollMs`: để `4000` (kiểm tra lệnh in mỗi 4 giây).

**5. Chạy:** bấm đúp vào **`start.bat`**. Một cửa sổ đen mở ra và hiện "Waiting for receipts…". **Giữ cửa sổ này mở** trong giờ làm việc.

**6. Trên điện thoại nhân viên:** vào màn **Bán hàng** → tick **"🖨️ In tại quầy lễ tân"** (chỉ cần bật 1 lần trên mỗi điện thoại). Thanh toán xong → hóa đơn tự in ra máy ở quầy.

---

## Cho tự chạy khi mở máy (khuyên dùng)

Để khỏi phải bấm `start.bat` mỗi sáng:
- Nhấn `Win + R` → gõ `shell:startup` → Enter (mở thư mục Startup).
- Chuột phải `start.bat` → **Create shortcut** → kéo shortcut vào thư mục Startup vừa mở.

Từ giờ mỗi lần bật máy lễ tân, cầu nối in tự chạy.

---

## Gặp lỗi?

- **Không in ra:** kiểm tra cửa sổ đen còn mở không; `config.json` đúng `apiBase`/`apiKey` chưa; `printer` đúng tên máy in chưa (hoặc để trống dùng máy mặc định).
- **In ra máy sai:** sửa `printer` trong `config.json` cho đúng tên, rồi tắt mở lại `start.bat`.
- **Cửa sổ báo "needs Node.js 18":** cài lại Node bản mới.
- Máy lễ tân **phải có mạng internet** (để nhận lệnh in từ điện thoại qua máy chủ).

> Lưu ý: bản này in theo dạng văn bản qua máy in Windows. Nếu cần định dạng nhiệt
> đặc biệt (tự cắt giấy, in logo…), báo để nâng cấp dùng lệnh ESC/POS cho đúng
> đời máy in của tiệm.
