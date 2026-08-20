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

**ĐÃ KIỂM (15/08/2026): CÓ Blueprint.** Tên `Lumio Booking`, gắn với `lumiobooking/lumio-booking` nhánh `main`, đang quản `lumio-web` và `lumio-api` (cả hai ở Oregon). Vậy bạn đi **Đường 1** — `render.yaml` thật sự điều khiển.

---

## ĐƯỜNG 1 — Đã có Blueprint  ← **đây là trường hợp của bạn**

### B0-a. TẠO NHÁNH `production` TRƯỚC KHI SYNC — thứ tự này quan trọng

`render.yaml` bảo hai service Mỹ theo nhánh `production`. **Nhánh đó chưa tồn tại.** Sync trước khi tạo nhánh là bảo Render trỏ hai service đang phục vụ tiệm thật vào một nhánh không có — không nên thử xem chuyện gì xảy ra.

Chạy **`deploy-to-us.bat`** một lần. Lần đầu nó chỉ tạo nhánh `production` từ `main`, đẩy lên GitHub, rồi thoát. Không deploy gì cả.

### B0-b. Đẩy code mới nhất lên `main`

Chạy **`Deploy update`**. Blueprint đọc `render.yaml` **từ nhánh `main`**, nên các thay đổi phải nằm trên đó trước khi sync.

### B1. Vào Blueprints → **Manual sync** (nút đen góc phải trên)

Render đọc lại `render.yaml` và báo trước những gì nó định làm:

- **Tạo mới:** `lumio-api-vn`, `lumio-web-vn` (Singapore, gói free)
- **Sửa `lumio-api` và `lumio-web`:** nhánh `main` → `production`, và thêm bước chạy test vào build

### B2. Đọc kỹ bảng thay đổi trước khi xác nhận

**Phải thấy** — với hai service Mỹ, chỉ có hai thay đổi: **branch** và **buildCommand**.

**KHÔNG được thấy** bất kỳ dòng nào nói sẽ:

- **xoá** hoặc **tạo lại** `lumio-api` / `lumio-web`
- đổi **region** của chúng (phải vẫn là **Oregon**)
- đổi **plan** (phải vẫn là **starter**)
- đụng tới `DATABASE_URL` hay bất kỳ biến bí mật nào

Thấy bất cứ dòng nào như vậy → **dừng, chụp màn hình gửi tôi.** Đừng bấm tiếp.

> Vì sao tôi liệt kê kỹ vậy: `render.yaml` trước đây **không khai region**, nên một lần sync có thể đã dời service đang chạy sang vùng mặc định của Render — đổi URL và làm gián đoạn tiệm đang mở cửa. Tôi đã khai rõ `region: oregon` cho hai service Mỹ để chuyện đó không xảy ra, nhưng bạn vẫn nên đọc bảng trước khi xác nhận.

### B3. Xác nhận. Hai service VN được tạo và bắt đầu build ngay

Build **sẽ thất bại lần đầu** vì chưa có `DATABASE_URL`. Đúng như dự kiến — sang Phần C.

Hai service Mỹ cũng sẽ build lại một lần (vì đổi nhánh). Bản chúng nhận là **đúng bản đang chạy**, vì `production` vừa tạo từ `main`.

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

- `https://lumio-api-uqm6.onrender.com/api/health` → ghi lại giá trị `db`
- `https://lumio-api-vn.onrender.com/api/health` → ghi lại giá trị `db`

**Hai giá trị `db` PHẢI KHÁC NHAU.**

Giống nhau nghĩa là bạn đã dán nhầm chuỗi Mỹ vào service VN. **Dừng ngay, sửa `DATABASE_URL` rồi deploy lại** trước khi tạo bất kỳ dữ liệu nào.

## D3. Giao diện VN

Mở `https://lumio-web-vn.onrender.com`

Phải thấy **huy hiệu đỏ 🇻🇳 VIỆT NAM** cạnh chữ Lumio. Không thấy → `NEXT_PUBLIC_MARKET` chưa đặt, hoặc đặt rồi mà **chưa build lại**.

## D4. Hệ thống Mỹ không bị đụng gì

Mở `https://lumio-api-uqm6.onrender.com/api/health` → giá trị `commit` **phải vẫn là bản cũ**, khác với `commit` của hệ thống VN. Đó là bằng chứng hai bên đang chạy hai nhánh khác nhau và hệ thống Mỹ đang được để yên.

Hai giá trị `commit` giống nhau ngay sau khi bạn đẩy code nghĩa là service Mỹ **vẫn đang theo nhánh `main`** — quay lại bước B3 đổi sang `production`.

---

# PHẦN E — Tạo tài khoản Super Admin cho hệ thống VN

Đây là **tài khoản mới duy nhất** phải tạo, và nó nằm **bên trong phần mềm**, không phải trên Render hay Neon.

Database VN vừa tạo hoàn toàn trống — không có người dùng nào, kể cả bạn. Tài khoản Super Admin bên Mỹ **không đăng nhập được** vào đây.

Tôi đã đọc lại code, và tìm ra một khoảng trống thật: **hệ thống chưa có cách nào tạo tài khoản đầu tiên.** API chỉ có `login`, không có đăng ký. Còn `db:seed` thì tạo mật khẩu `Password123!` — chuỗi này in công khai trong repo — kèm hai tiệm demo giả. Không được phép chạy nó trên hệ thống thật.

Nên tôi làm một cánh cửa hẹp, khoá bằng **hai ổ khoá độc lập**:

1. **Database phải trống hoàn toàn.** Có đúng một tài khoản là cửa đóng vĩnh viễn — đóng bằng *một sự thật về dữ liệu*, không phải bằng cái cờ ai đó phải nhớ tắt. Đây là lý do để endpoint này nằm lại trong code mãi mãi cũng an toàn.
2. **Một mã bí mật** (`BOOTSTRAP_TOKEN`). Không có ổ khoá này thì ai tìm thấy hệ thống mới trước chủ của nó đều chiếm được. **Không đặt biến = cửa không tồn tại** — nên hệ thống Mỹ đang chạy hoàn toàn không bị ảnh hưởng, ở đó đã có hàng nghìn user nên ổ khoá thứ nhất cũng đã đóng sẵn.

### Các bước

**E1.** Vào `lumio-api-vn` → **Environment** → tìm `BOOTSTRAP_TOKEN`. Blueprint đã khai `generateValue: true` nên Render tự sinh sẵn. Bấm biểu tượng con mắt để xem, **copy giá trị**.

**E2.** Mở `https://lumio-web-vn.onrender.com/bootstrap`

**E3.** Điền họ tên, email đăng nhập, mật khẩu, và dán mã ở bước E1 vào ô **Mã thiết lập**.

Mật khẩu phải **từ 12 ký tự, có chữ hoa, chữ thường và số**. Hệ thống **từ chối thẳng** chuỗi `Password123!` vì nó nằm công khai trong repo.

> Mật khẩu chỉ đi từ trình duyệt của bạn tới máy chủ của bạn. **Lưu ngay vào trình quản lý mật khẩu** — hệ thống chưa có chức năng quên mật khẩu, và trang này chỉ chạy được một lần.

**E4.** Tạo xong → **quay lại Render xoá biến `BOOTSTRAP_TOKEN`**. Cửa đã tự khoá bằng ổ thứ nhất rồi, nhưng một chiếc chìa không dùng tới vẫn là một chiếc chìa.

**E5.** Đăng nhập ở `https://lumio-web-vn.onrender.com/login`

### Nếu trang báo lỗi

| Thông báo | Nghĩa là |
|---|---|
| *"This system already has an account"* | Đã có tài khoản — dùng trang đăng nhập, đừng tạo lại |
| *"Setup is not available"* | Mã sai, hoặc `BOOTSTRAP_TOKEN` chưa đặt / ngắn hơn 16 ký tự |
| Báo về mật khẩu | Chưa đủ 12 ký tự, hoặc thiếu chữ hoa/thường/số |

Endpoint này giới hạn **5 lần thử mỗi giờ**, nên đoán mã là vô ích.

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

---

# PHỤ LỤC — Ba lỗi build lần sync đầu tiên (19/08/2026) và cách xử lý

Sync xong thì cả ba service báo build failed. Hai lỗi đầu **là lỗi của tôi**, lỗi thứ ba là **đúng như dự kiến**.

## Lỗi 1 & 2 — `lumio-api`, `lumio-web`: `Missing script: "test:guards"`

**Nguyên nhân:** Blueprint đọc `render.yaml` từ nhánh **`main`**, nhưng mỗi service build **commit trên nhánh của chính nó**. Hai service Mỹ đã đổi sang nhánh `production`, mà `production` lúc đó đang ở commit `15c92fb` — commit **cũ hơn** lúc tôi thêm script `test:guards` vào `package.json` (`486a1b6`).

Nên: lệnh build mới + code cũ = gọi một script chưa tồn tại.

Nói cách khác, **cái lưới an toàn tôi thêm vào để bảo vệ hệ thống Mỹ lại chính là thứ làm hỏng deploy của nó.** Đây là lỗi thiết kế của tôi, không phải bạn làm sai bước nào.

**Đã sửa:** đổi thành `npm run test:guards --if-present` ở cả bốn service. Đã kiểm ba trường hợp:

| Tình huống | Kết quả |
|---|---|
| Commit cũ, chưa có script | **bỏ qua**, build chạy tiếp |
| Commit mới, có script | **chạy test** như thường |
| Test có chạy nhưng **thất bại** | **vẫn chặn deploy** |

Điều quan trọng: lưới an toàn không mất tác dụng, nó chỉ thôi làm kẹt cỗ máy nó sinh ra để bảo vệ.

**Việc cần làm:** chạy `Deploy update` để đẩy bản sửa lên `main`, rồi vào Blueprints bấm **Manual sync** lần nữa.

Hai service Mỹ sẽ build lại **vẫn từ commit `15c92fb`** — tức **đúng bản chúng đang chạy trước giờ**. Không có gì mới tới tay tiệm Mỹ. Đó là điều đúng: 7 commit trên `main` **chưa được thử ở Việt Nam**, nên chưa được phát hành.

## Lỗi 3 — `lumio-api-vn`: `db:migrate:deploy` thất bại, `Validation Error: env("DATABASE_URL")`

**Đúng như đã báo trước.** Service chưa có chuỗi kết nối nên Prisma không biết chạy migration vào đâu.

**Cách xử lý:** làm **Phần C** — điền `DATABASE_URL` và các biến còn lại cho `lumio-api-vn`, rồi **Manual Deploy → Deploy latest commit**.

## Thứ tự làm ngay bây giờ

1. `Deploy update` (đẩy bản sửa `--if-present` lên `main`)
2. Điền biến môi trường cho `lumio-api-vn` và `lumio-web-vn` — **Phần C**
3. Blueprints → **Manual sync**
4. Kiểm theo **Phần D**

**Chưa chạy `deploy-to-us.bat`.** Để `production` nằm yên ở `15c92fb` cho tới khi bạn thử xong ở Việt Nam.
