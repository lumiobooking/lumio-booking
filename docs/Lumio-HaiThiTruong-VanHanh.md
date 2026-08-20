# Hai thị trường, một bộ code — cách vận hành

Ngày lập: 15/08/2026.

Mục tiêu: **xây tiếp cho Việt Nam mà không thể làm hỏng hệ thống Mỹ/Canada đang chạy thật.**

---

## Vì sao chọn cách này

Có ba cách tách, tôi chọn cách giữa và nói rõ vì sao bỏ hai cách kia.

**Tách bằng cờ trong cùng một hệ thống** — rẻ nhất, nhưng không hứa được điều bạn cần. Một migration hỏng, một vòng lặp treo, một rò rỉ bộ nhớ **kéo sập cả tiến trình**, và tiến trình đó đang phục vụ tiệm Mỹ. Cờ chỉ tách *hành vi*, không tách *sự cố*.

**Tách hẳn nhánh code riêng** — cách ly tuyệt đối, nhưng một người duy trì hai nhánh nghĩa là **hai nhánh trôi xa nhau**. Mỗi lỗi phải sửa hai lần và phải nhớ hai lần. Vài tháng nữa bạn sẽ có hai sản phẩm khác nhau mà không định thế.

**Cách đang dùng: cùng một commit, chạy ở hai nơi, mỗi nơi một cơ sở dữ liệu.** Cách ly nằm ở **lúc chạy và ở dữ liệu**, không nằm ở mã nguồn. Không có gì để trôi xa nhau.

---

## Bốn service trên Render

| Service | Gói | Theo nhánh | Tự động deploy | Cơ sở dữ liệu |
|---|---|---|---|---|
| `lumio-api` | starter | **`production`** | Có | Neon US (hiện tại) |
| `lumio-web` | starter | **`production`** | Có | — |
| `lumio-api-vn` | free | **`main`** | Có | **Neon VN (mới, phải tạo)** |
| `lumio-web-vn` | free | **`main`** | Có | — |

**Cột quan trọng nhất là cột nhánh, không phải cột auto-deploy.**

Cả bốn service đều bật auto-deploy — **bạn không phải bấm gì trong Render, và cũng không phải bật/tắt cái gì bao giờ.** Thứ ngăn cách hai thị trường là **nhánh code**:

- Đẩy code → vào `main` → **chỉ Việt Nam nhận**
- Muốn Mỹ nhận → **gộp `main` vào `production`** → Mỹ nhận

Cửa chặn nằm ở git, không nằm ở một công tắc trong bảng điều khiển. Không ai phải nhớ bấm, và cũng **không ai quên bấm được** — vì việc phát hành là một hành động có tên, có ngày, có commit để chỉ vào khi cần truy.

---

## Cần làm một lần, trên Render

1. **Tạo một database Neon MỚI.** Tuyệt đối không trỏ vào chuỗi kết nối của Mỹ — đây chính là sai lầm mà toàn bộ cách sắp xếp này sinh ra để ngăn.
2. `lumio-api-vn` → `DATABASE_URL` = chuỗi Neon mới
3. `lumio-api-vn` → `CORS_ORIGINS` = `https://lumio-web-vn.onrender.com`
4. `lumio-web-vn` → `NEXT_PUBLIC_API_URL` = `https://lumio-api-vn.onrender.com/api`
5. `lumio-api-vn` → `ANTHROPIC_API_KEY` nếu muốn bot AI chạy ở VN

Twilio, Stripe, Brevo **để trống được**. Một tiệm Việt Nam thu tiền mặt và nhắn qua Messenger không cần cái nào trong số đó ngày đầu tiên.

---

## Quy trình từ nay

```
sửa code
   ↓
chạy  deploy.bat  ("Deploy update")        → đẩy vào nhánh main
   ↓
lumio-api-vn + lumio-web-vn tự build       ← CHỈ Việt Nam nhận
   ↓
mở lumio-api-vn.onrender.com/api/health, xem "commit" đúng chưa
   ↓
dùng thử ở Việt Nam
   ↓
ổn → chạy  deploy-to-us.bat                → gộp main vào production
   ↓
lumio-api + lumio-web tự build             ← Mỹ nhận
```

**Hai script, cố ý tách rời.** Hai việc này có hậu quả rất khác nhau, không nên dùng chung một nút bấm.

`deploy-to-us.bat` sẽ:

1. **Từ chối chạy** nếu còn thay đổi chưa commit — thứ chưa được thử ở Việt Nam thì không được đi cùng chuyến
2. **In ra đúng danh sách** những thay đổi tiệm Mỹ sắp nhận, kèm số lượng
3. Hỏi bạn gõ `YES` — hỏi thẳng *"đã thử ở Việt Nam chưa"*
4. Chỉ gộp kiểu **fast-forward**. Nếu `production` có commit mà `main` không có, nó **dừng và không đổi gì**, thay vì gộp bừa
5. Nếu không có gì mới thì báo *"Mỹ đã cập nhật rồi"* và thoát

---

## Lưới an toàn: bộ test chặn deploy

`npm run test:guards` chạy **trước khi build**, ở cả hai thị trường. Deploy thất bại nếu nó hỏng.

97 test khoá chặt những thứ tiệm Mỹ/Canada đang phụ thuộc:

- **Tiền** — USD/CAD hiển thị giống từng ký tự bản cũ; ô nhập giá lưu đúng số nguyên cũ; giá lưu bởi code cũ mở ra sửa rồi lưu lại vẫn ra đúng số đó
- **Số điện thoại** — 11 cách viết số Mỹ/Canada cho ra kết quả y hệt quy tắc cũ
- **Ngày giờ và ngôn ngữ** — tiệm chưa khai quốc gia vẫn ra `en-US`
- **Năm cổng chặn của bot bán hàng** — mọi câu trong đó là **câu thật khách đã nhận**

Tôi đã thử phá: cố tình gài lại lỗi chia 100 → **2 test đỏ, deploy dừng**. Khôi phục → 97 xanh.

**Đây là thứ trước đây không có.** Mọi lần tôi nói "0 sai lệch" trong mấy ngày qua đều là kiểm tay rồi vứt file đi — nghĩa là lần sửa sau có thể phá hỏng tiệm Mỹ mà không ai biết cho tới khi khách phàn nàn.

---

## Khi nào nâng `lumio-api-vn` lên gói trả phí

Ngay ngày đầu tiên có **một tiệm Việt Nam thật** phụ thuộc vào nó. Gói free ngủ sau **15 phút** không ai dùng, khởi động lại mất **30–60 giây** — trang đặt lịch của khách trắng màn hình nửa phút rồi họ bỏ đi. Giá: **$7/tháng**.

---

## Chi phí — tra ngày 15/08/2026

**Bắt đầu thì không phải trả thêm đồng nào.**

| Hạng mục | Gói free cho phép | Đủ cho giai đoạn thử? |
|---|---|---|
| Database Neon thứ hai | **100 project** miễn phí, 0,5 GB mỗi project, 100 CU-hours/tháng | Dư sức |
| `lumio-api-vn` | web service free, 512 MB RAM | Đủ để chạy thử |
| `lumio-web-vn` | web service free | Đủ để chạy thử |

Nên hai service VN trong `render.yaml` đặt `plan: free`, và database Neon thứ hai **không tốn phí**.

### Hai chỗ sẽ phát sinh tiền, biết trước để không bị bất ngờ

**1. Service free ngủ sau 15 phút không ai dùng, khởi động lại mất 30–60 giây.**
Đang thử thì không sao. Nhưng ngày có **một tiệm Việt Nam thật**, khách của họ mở trang đặt lịch và phải chờ nửa phút màn hình trắng — họ bỏ đi. Lúc đó nâng `lumio-api-vn` lên **$7/tháng**. Web có thể để free lâu hơn một chút, nhưng API thì không.

**2. Build minutes — 500 phút/tháng cho cả workspace, và đây là chỗ dễ vượt nhất.**
Trước có 2 service build, nay có **4**. Cộng thêm bộ test tôi vừa gắn vào trước mỗi lần build. Mỗi lần `Deploy update` giờ chạy build ở hai service VN; deploy Mỹ chạy thêm hai lần nữa.

Nếu tháng nào bạn sửa nhiều, đây là hạn mức chạm trước tiên — trước cả RAM hay dung lượng. Theo dõi ở phần Usage trong Render.

**Tổng kết ngắn:** hôm nay **$0 thêm**. Khi có tiệm VN đầu tiên trả tiền: **$7/tháng**. Nếu build vượt 500 phút thì thêm phần vượt.

---

## Nhược điểm phải biết trước

- **Thêm chi phí về sau:** xem bảng trên — $0 lúc đầu, $7/tháng khi có tiệm thật.
- **Deploy Mỹ giờ là việc tay.** Đó là cái giá của việc không thể lỡ tay. Nhưng nghĩa là bạn phải **nhớ bấm** — bản sửa lỗi cho Mỹ sẽ nằm im nếu bạn quên.
- **Người dùng và tiệm ở hai bên hoàn toàn tách biệt.** Tài khoản Super Admin bên Mỹ **không đăng nhập được** vào hệ thống VN. Phải tạo tài khoản riêng.
- **Không so sánh báo cáo giữa hai bên được** — hai database, không có cái nhìn tổng hợp. Nếu sau này cần, đó là việc phải làm thêm.

---

## Một địa chỉ duy nhất: lumiobooking.com

Bạn giữ **một tên miền**. Khách vào `lumiobooking.com`, chọn khu vực **một lần**, và từ đó vào thẳng hệ thống đúng. Không có tên miền thứ hai, không có `/vn` ở cuối, không đổi DNS.

### Cái gì dùng chung, cái gì không

**Dùng chung:** giao diện web. Nó là lớp vỏ — HTML, JavaScript, giao diện. **Nó không chứa dữ liệu của tiệm nào cả.**

**Không dùng chung — và đây mới là phần quan trọng:** máy chủ dữ liệu và cơ sở dữ liệu.

| | Hệ thống Mỹ | Hệ thống Việt Nam |
|---|---|---|
| Địa chỉ | `lumiobooking.com` | `lumiobooking.com` — **cùng một địa chỉ** |
| Giao diện | dùng chung | dùng chung |
| **Máy chủ dữ liệu** | `lumio-api` (Oregon) | **`lumio-api-vn` (Singapore)** |
| **Cơ sở dữ liệu** | Neon US | **Neon VN — khác hẳn** |
| Tài khoản đăng nhập | riêng | **riêng, không dùng chung** |

Máy chủ Mỹ **không có cả chuỗi kết nối** tới database Việt Nam, và ngược lại. Chọn khu vực chỉ đổi *máy chủ nào trả lời trình duyệt này* — nó không thể lộ dữ liệu thị trường kia hơn là việc bạn gõ một địa chỉ khác vào thanh URL.

Lớp bảo vệ tenant vẫn nằm đúng chỗ cũ: mọi truy vấn lọc theo tenant đã đăng nhập, trên một máy chủ chỉ biết một database.

### Vì sao không có công tắc đổi thị trường trong Super Admin

Nếu có một công tắc như vậy, nghĩa là **một tiến trình cầm chìa khoá của cả hai kho dữ liệu**. Chỉ cần một lỗi phân quyền, một truy vấn quên lọc — và tiệm Việt Nam nhìn thấy dữ liệu tiệm Mỹ.

Lựa chọn khu vực nằm trong **trình duyệt của từng người**, là nơi duy nhất nó không thể gây rò rỉ: một trình duyệt chỉ cầm phiên đăng nhập của một người, và chỉ nói chuyện với một máy chủ tại một thời điểm.

### Hai chi tiết đã xử lý

**Phiên đăng nhập không đè lên nhau.** Cùng một tên miền nghĩa là cùng một kho lưu trữ trình duyệt, và cả hai đều lưu phiên dưới tên `lumio_auth`. Nếu không tách, đăng nhập VN sẽ ghi đè phiên Mỹ và trình duyệt bắt đầu gửi token VN sang máy chủ Mỹ. Nay mỗi khu vực có ngăn riêng — **Mỹ giữ nguyên tên cũ**, nên ai đang đăng nhập vẫn đăng nhập bình thường sau khi cập nhật.

**Bất động cho tới khi bạn bật.** Khi chưa khai địa chỉ API Việt Nam, mọi thứ chạy **y hệt hôm nay**: không hỏi khu vực, không đổi tên ngăn lưu trữ, mọi request đi tới đúng `NEXT_PUBLIC_API_URL` cũ. Đây là điều đầu tiên bộ test kiểm.

### Còn một nửa chưa làm: link đặt lịch công khai

Trang đặt lịch khách hàng (`/book/tên-tiệm`) **chưa biết khu vực**. Khách của tiệm không hề chọn gì — họ bấm link tiệm gửi. Nên link cho tiệm Việt Nam cần **tự mang theo khu vực**.

Chưa làm vì nó quyết định luôn định dạng link mà plugin WordPress sinh ra, và tôi muốn bàn trước khi chốt. **Chưa có tiệm Việt Nam nào chạy nên chưa chặn việc gì** — nhưng phải làm trước tiệm đầu tiên.

---

