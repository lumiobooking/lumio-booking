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

---

## In thử

Bấm đúp **`test.bat`**: mỗi máy in trong `config.json` in ra một phiếu mẫu (có tiếng Việt, tên bàn chữ to). Dùng mỗi khi cài máy mới hoặc đổi máy in.

---

## Kiểu in (mới)

| Kiểu | Khi nào dùng | Ưu điểm |
|---|---|---|
| **Font Windows** (mặc định) | Máy in cắm USB / LAN đã cài driver Windows | **Có dấu tiếng Việt**, tên bàn **chữ to**, món **in đậm**, cỡ chữ tự vừa khổ giấy 58/80mm. Máy **tự cắt giấy** nếu driver bật "Cut at end of document" (Xprinter, Epson, Rongta… đều có, thường bật sẵn). |
| **ESC/POS qua mạng** | Máy in nhiệt có cổng LAN (có IP), không cần cài driver | Chữ to, tự cắt giấy, có thể **kêu bíp** ở bếp. Hầu hết máy in nhiệt không có bảng mã tiếng Việt nên phiếu **in không dấu** ("Pho bo tai"). |
| **Văn bản** (`"mode": "text"`) | Chỉ khi hai kiểu trên không chạy | Cách in cũ, chữ thường. |

Nếu in kiểu Font Windows bị lỗi, chương trình **tự in lại bằng kiểu văn bản**, không mất phiếu.

Đổi font (mặc định Consolas; máy không có thì dùng Courier New): thêm `"font": "Courier New"` vào `config.json`.

---

## Nhà hàng: in phiếu bếp / bar riêng

Mỗi lần bấm **Báo bếp**, Lumio tạo một phiếu cho từng khu (Bếp, Bar…). Muốn mỗi khu ra đúng máy in của khu đó, thêm `printers` vào `config.json`:

```json
{
  "apiBase": "https://YOUR-LUMIO-API.onrender.com/api",
  "apiKey": "PASTE-YOUR-SALON-API-KEY-HERE",
  "printer": "",
  "printers": {
    "COUNTER": "EPSON TM-T82",
    "KITCHEN": { "host": "192.168.1.50", "beep": true },
    "BAR": "XP-58 Bar"
  },
  "pollMs": 3000
}
```

- `COUNTER` = máy ở quầy (hoá đơn, phiếu tạm tính). `KITCHEN`, `BAR` = mã khu trong Thu ngân › Cài đặt nhà hàng (mã hiện cạnh tên khu).
- Ghi **tên máy in trong Windows** (Settings › Printers & scanners) để in kiểu Font Windows.
- Ghi `{ "host": "IP máy in" }` để in thẳng qua mạng (ESC/POS, cổng 9100). Thêm `"beep": true` cho máy có còi; `"port": 9100` nếu máy dùng cổng khác.
- Xem IP máy in: tắt máy in, giữ nút FEED rồi bật lại, máy in ra trang cấu hình có dòng IP.
- Không có `printers`: mọi phiếu ra một máy (`printer`) như trước.
- Hai máy tính khác nhau có thể chạy hai bản Lumio Print, mỗi bản chỉ ghi những khu mình phụ trách.
