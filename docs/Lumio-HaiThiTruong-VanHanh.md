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

| Service | Gói | Tự động deploy | Cơ sở dữ liệu |
|---|---|---|---|
| `lumio-api` | starter | **KHÔNG** | Neon US (hiện tại) |
| `lumio-web` | starter | **KHÔNG** | — |
| `lumio-api-vn` | free | **CÓ** | **Neon VN (mới, phải tạo)** |
| `lumio-web-vn` | free | **CÓ** | — |

**Điểm quan trọng nhất trong bảng này là hai chữ KHÔNG.**

Từ giờ, `Deploy update` **không còn tự đẩy bản mới vào hệ thống Mỹ nữa**. Nó đẩy vào Việt Nam. Muốn Mỹ nhận bản mới thì bạn **vào Render bấm Deploy** — sau khi đã thấy nó chạy được ở Việt Nam.

Đây là dòng cấu hình biến câu *"không đụng chạm hệ thống cũ"* từ **mong muốn** thành **sự thật**.

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
sửa code → Deploy update (đẩy lên GitHub)
   ↓
lumio-api-vn + lumio-web-vn tự build      ← Việt Nam nhận trước
   ↓
mở /api/health, xem "commit" đúng chưa
   ↓
dùng thử ở Việt Nam
   ↓
ổn → vào Render, bấm Deploy trên lumio-api rồi lumio-web   ← Mỹ nhận sau
```

**Thứ tự khi deploy Mỹ: API trước, web sau.** Web được build kèm sẵn địa chỉ API, nên nếu web lên trước mà API chưa có tính năng mới thì giao diện sẽ gọi vào chỗ chưa tồn tại.

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

Ngay ngày đầu tiên có **một tiệm Việt Nam thật** phụ thuộc vào nó. Gói free ngủ sau 15 phút không ai dùng, và tiệm ngủ nghĩa là **trang đặt lịch của khách quay vòng ba mươi giây** rồi họ bỏ đi.

---

## Nhược điểm phải biết trước

- **Thêm chi phí:** hai service nữa trên Render, một database Neon nữa.
- **Deploy Mỹ giờ là việc tay.** Đó là cái giá của việc không thể lỡ tay. Nhưng nghĩa là bạn phải **nhớ bấm** — bản sửa lỗi cho Mỹ sẽ nằm im nếu bạn quên.
- **Người dùng và tiệm ở hai bên hoàn toàn tách biệt.** Tài khoản Super Admin bên Mỹ **không đăng nhập được** vào hệ thống VN. Phải tạo tài khoản riêng.
- **Không so sánh báo cáo giữa hai bên được** — hai database, không có cái nhìn tổng hợp. Nếu sau này cần, đó là việc phải làm thêm.
