# Dựng hệ thống Việt Nam — làm từng bước

Ngày lập: 15/08/2026.

**Câu trả lời ngắn: KHÔNG tạo tài khoản mới nào cả.** Vẫn tài khoản Neon đó, vẫn tài khoản Render đó. Bạn chỉ thêm **1 project** trong Neon và **2 service** trong Render.

Tài khoản mới duy nhất phải tạo là **tài khoản Super Admin bên trong phần mềm VN** — cái đó ở bước cuối, sau khi hệ thống chạy.

---

# PHẦN A — Neon: thêm một project

Ảnh bạn gửi cho thấy tổ chức **Lumio Booking**, gói **Launch**, đang có **1 project** tên `Lumiobooking` ở vùng AWS US East 1.

### A1. Bấm **New project** (nút đen góc phải trên)

### A2. Điền

| Ô | Điền gì | Vì sao |
|---|---|---|
| **Project name** | `Lumiobooking-VN` | Nhìn tên là biết ngay, không nhầm với project Mỹ |
| **Postgres version** | để nguyên mặc định | |
| **Region** | **AWS Asia Pacific 1 (Singapore)** | Xem lưu ý ngay dưới |

**Lưu ý về Region — đọc trước khi chọn:**

Database nên đặt **cùng vùng với máy chủ**, không phải cùng vùng với khách. Mỗi lần máy chủ hỏi database là một vòng đi–về; nếu hai bên cách nhau nửa vòng trái đất thì mỗi trang tải sẽ cộng thêm vài trăm mili giây.

Nên chọn theo cặp:

- Nếu ở Phần B bạn đặt hai service Render ở **Singapore** → Neon chọn **Singapore**
- Nếu bạn để service Render ở **Ohio/Oregon** → Neon cũng chọn **US East**

**Khuyến nghị: Singapore cho cả hai.** Tra ngày 15/08/2026: Render có 4 vùng — Oregon, Ohio, Frankfurt, **Singapore** — và **gói free chạy được ở Singapore**. Khách Việt Nam ở gần đó, nên máy chủ nên ở đó, và database phải ở cùng vùng với máy chủ.

**Chọn lệch nhau còn tệ hơn để cả hai ở Mỹ**: mỗi câu truy vấn sẽ bay qua Thái Bình Dương rồi bay về, và một trang thường hỏi database nhiều lần.

### A3. Sau khi project tạo xong → lấy chuỗi kết nối

Trong project mới, tìm nút **Connect** (hoặc mục **Connection string**). Chọn:

- Branch: `main` (hoặc `production`)
- Database: `neondb`
- **Bật "Pooled connection"** nếu có tuỳ chọn này

Copy chuỗi có dạng:

```
postgresql://TÊN:MẬT_KHẨU@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

**Giữ tab này mở** — bước B4 cần dán chuỗi đó.

> Chuỗi này là mật khẩu vào toàn bộ dữ liệu. Đừng gửi qua chat, đừng dán vào file trong dự án. Chỉ dán thẳng vào ô của Render.

**Chi phí:** bạn đang ở gói **Launch**, project thứ hai nằm trong gói, không phát sinh thêm.

---

# PHẦN B — Render: kiểm tra trước, rồi mới thêm

## B0. Kiểm tra điều này TRƯỚC — nó quyết định bạn đi đường nào

Trong Render, menu trái có mục **Blueprints**. Bấm vào.

**Có phải quyết định quan trọng nhất của cả hướng dẫn này**, vì hai trường hợp làm hoàn toàn khác nhau:

| Bạn thấy gì | Nghĩa là | Đi đường |
|---|---|---|
| Có một blueprint đang gắn với repo `lumio-booking` | Hai service hiện tại sinh ra từ `render.yaml` | **Đường 1** |
| Trống, không có blueprint nào | Hai service được tạo bằng tay; file `render.yaml` trong dự án **hiện không có tác dụng gì** | **Đường 2** |

Ảnh bạn gửi cho thấy hai service đang nằm ở **"Ungrouped Services"** — dấu hiệu **có thể** là tạo tay. Nhưng tôi không nhìn được màn hình Blueprints của bạn nên **bạn phải tự kiểm**, đừng đoán.

---

## ĐƯỜNG 1 — Đã có Blueprint

### B1. Vào Blueprints → chọn blueprint đó → **Sync** (hoặc **Apply changes**)

Render đọc lại `render.yaml` và sẽ báo trước những gì nó định làm:

- **Tạo mới:** `lumio-api-vn`, `lumio-web-vn`
- **Sửa:** `lumio-api` và `lumio-web` → tắt auto-deploy

### B2. Đọc kỹ bảng thay đổi trước khi xác nhận

Điều **phải thấy**: hai service Mỹ chỉ đổi mỗi `autoDeploy`. Điều **không được thấy**: bất kỳ dòng nào nói sẽ **xoá**, **thay** hay **đổi database** của `lumio-api`.

Nếu thấy bất cứ dòng nào như vậy → **dừng lại, chụp màn hình gửi tôi**. Đừng bấm tiếp.

### B3. Xác nhận. Hai service VN sẽ được tạo và bắt đầu build ngay

Build **sẽ thất bại** ở lần đầu vì chưa có `DATABASE_URL`. Đúng như dự kiến — sang B4.

---

## ĐƯỜNG 2 — Chưa có Blueprint (tạo tay)

Trường hợp này `render.yaml` chỉ là tài liệu, không điều khiển gì. Bạn tạo tay hai service, và **tự tắt auto-deploy** cho hai service Mỹ.

### B1. Tạo `lumio-api-vn`

**+ New → Web Service** → chọn repo `lumio-booking`

| Ô | Điền |
|---|---|
| Name | `lumio-api-vn` |
| Region | **Singapore** — phải khớp với vùng Neon đã chọn |
| Branch | `main` |
| Root Directory | *(để trống)* |
| Runtime | Node |
| Build Command | `npm install --include=dev && npm run db:generate --workspace=apps/api && npm run test:guards && npm run build --workspace=apps/api && npm run db:migrate:deploy --workspace=apps/api` |
| Start Command | `node apps/api/dist/src/main.js` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |

### B2. Tạo `lumio-web-vn`

**+ New → Web Service** → cùng repo

| Ô | Điền |
|---|---|
| Name | `lumio-web-vn` |
| Region | **Singapore** — giống service API |
| Branch | `main` |
| Build Command | `npm install --include=dev && npm run test:guards && NODE_OPTIONS=--max-old-space-size=4096 npm run build --workspace=apps/web` |
| Start Command | `cd apps/web && npx next start -p $PORT` |
| Instance Type | **Free** |

### B3. ĐỔI NHÁNH CHO HAI SERVICE MỸ — đừng bỏ qua bước này

Đây là bước biến *"không đụng chạm hệ thống cũ"* thành sự thật. Ở đường 2, Render **không tự làm giúp**.

**Chạy `deploy-to-us.bat` một lần trước** — lần đầu chạy, nó tự tạo nhánh `production` từ `main` rồi thoát. Sau đó nhánh mới tồn tại để chọn trong Render.

Rồi với **`lumio-api`** và **`lumio-web`**:

**Settings** → mục **Build & Deploy** → **Branch** → đổi từ `main` sang **`production`** → **Save**

**Auto-Deploy để nguyên Yes.** Bạn không tắt gì cả.

Từ lúc này, đẩy code lên GitHub vào `main` **chỉ tới Việt Nam**. Mỹ chỉ nhận khi bạn chạy `deploy-to-us.bat` để gộp `main` vào `production`.

---

# PHẦN C — Điền biến môi trường (cả hai đường đều làm giống nhau)

## C1. `lumio-api-vn` → **Environment**

| Key | Value |
|---|---|
| `DATABASE_URL` | **chuỗi Neon MỚI** đã copy ở A3 |
| `MARKET` | `VN` |
| `CORS_ORIGINS` | `https://lumio-web-vn.onrender.com` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | bấm **Generate** để Render tự sinh |
| `JWT_ACCESS_EXPIRES_IN` | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `BCRYPT_SALT_ROUNDS` | `12` |
| `ANTHROPIC_API_KEY` | khoá của bạn, nếu muốn bot AI chạy ở VN |
| `KEEPALIVE_START_HOUR` | `8` |
| `KEEPALIVE_END_HOUR` | `22` |
| `KEEPALIVE_TZ` | `Asia/Ho_Chi_Minh` |

**Twilio, Stripe, Brevo, PayPal, Gmail: bỏ trống.** Tiệm Việt Nam thu tiền mặt và nhắn qua Messenger không cần cái nào trong số đó ngày đầu.

### ⚠️ Kiểm hai lần trước khi lưu

Mở `DATABASE_URL` của `lumio-api` (Mỹ) và của `lumio-api-vn` đặt cạnh nhau. **Hai chuỗi phải khác nhau.**

Nếu giống nhau, hệ thống Việt Nam sẽ ghi thẳng vào dữ liệu tiệm Mỹ — **đúng một sai lầm mà toàn bộ cách sắp xếp này sinh ra để ngăn.**

## C2. `lumio-web-vn` → **Environment**

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://lumio-api-vn.onrender.com/api` |
| `NEXT_PUBLIC_MARKET` | `VN` |
| `NODE_ENV` | `production` |

`NEXT_PUBLIC_*` được **nướng vào lúc build**, nên sau khi sửa hai ô này phải **build lại** thì mới có tác dụng.

## C3. Bấm **Manual Deploy → Deploy latest commit** cho cả hai service VN

---

# PHẦN D — Kiểm tra đã đúng chưa (5 phút)

## D1. Máy chủ VN sống chưa

Mở: `https://lumio-api-vn.onrender.com/api/health`

Phải thấy đại khái:

```json
{ "status": "ok", "database": "up", "market": "VN", "db": "a1b2c3d4", "commit": "15efbee" }
```

| Thấy gì | Nghĩa là |
|---|---|
| `"market": "VN"` | Đúng hệ thống |
| `"database": "up"` | Nối được Neon mới |
| `"database": "down"` | Chuỗi `DATABASE_URL` sai hoặc thiếu `?sslmode=require` |
| Chờ 30–60 giây rồi mới hiện | Bình thường — service free vừa ngủ dậy |

## D2. **BÀI KIỂM QUAN TRỌNG NHẤT** — hai hệ thống có chung database không

Mở **cả hai** trong hai tab:

- `https://lumio-api.onrender.com/api/health` → ghi lại giá trị `db`
- `https://lumio-api-vn.onrender.com/api/health` → ghi lại giá trị `db`

**Hai giá trị `db` PHẢI KHÁC NHAU.**

Giống nhau nghĩa là bạn đã dán nhầm chuỗi Mỹ vào service VN. **Dừng ngay, sửa `DATABASE_URL` rồi deploy lại** trước khi tạo bất kỳ dữ liệu nào.

## D3. Giao diện VN

Mở `https://lumio-web-vn.onrender.com`

Phải thấy **huy hiệu đỏ 🇻🇳 VIỆT NAM** cạnh chữ Lumio. Không thấy → `NEXT_PUBLIC_MARKET` chưa đặt, hoặc đặt rồi mà **chưa build lại**.

## D4. Hệ thống Mỹ không bị đụng gì

Mở `https://lumio-api.onrender.com/api/health` → giá trị `commit` **phải vẫn là bản cũ**, khác với `commit` của hệ thống VN. Đó là bằng chứng hai bên đang chạy hai nhánh khác nhau và hệ thống Mỹ đang được để yên.

Hai giá trị `commit` giống nhau ngay sau khi bạn đẩy code nghĩa là service Mỹ **vẫn đang theo nhánh `main`** — quay lại bước B3 đổi sang `production`.

---

# PHẦN E — Tạo tài khoản Super Admin cho hệ thống VN

Đây là **tài khoản mới duy nhất** phải tạo, và nó nằm **bên trong phần mềm**, không phải trên Render hay Neon.

Database VN vừa tạo hoàn toàn trống — không có người dùng nào, kể cả bạn. Tài khoản Super Admin bên Mỹ **không đăng nhập được** vào đây.

Cách tạo tài khoản đầu tiên tuỳ vào cơ chế khởi tạo của phần mềm. **Nhắn cho tôi khi bạn tới bước này**, tôi đọc lại code phần đăng ký/seed rồi chỉ đúng cách — tôi không muốn đoán bước liên quan tới mật khẩu.

---

# Tóm tắt: bạn phải tạo gì

| | Tạo mới? |
|---|---|
| Tài khoản Neon | **Không** — dùng tài khoản đang có |
| Tài khoản Render | **Không** — dùng tài khoản đang có |
| Project Neon | **Có** — 1 project `Lumiobooking-VN` |
| Service Render | **Có** — 2 service `lumio-api-vn`, `lumio-web-vn` |
| Tài khoản Super Admin trong phần mềm VN | **Có** — làm ở Phần E |

---

# Nếu có gì đó sai

Chụp màn hình gửi tôi, kèm **nội dung log build** ở Render (tab **Logs** của service). Đừng chụp màn hình có chứa `DATABASE_URL` hay bất kỳ khoá bí mật nào — che phần đó trước khi gửi.
