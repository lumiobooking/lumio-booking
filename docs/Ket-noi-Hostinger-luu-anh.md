# Nối Hostinger vào Lumio để lưu ảnh bài đăng

Màn hình cấu hình đã có sẵn trong hệ thống. Việc của anh là lấy 5 thông tin từ Hostinger rồi điền vào.

**Quan trọng về bảo mật:** mật khẩu FTP anh gõ **thẳng vào Lumio**, đừng dán vào chat với tôi hay gửi qua tin nhắn. Tôi không cần biết nó để hướng dẫn.

---

## Phần 1 — Lấy thông tin từ hPanel

### 1.1. Tạo thư mục chứa ảnh

hPanel → **Trang web** → chọn website → **Tệp** → **Trình quản lý tệp**

Vào thư mục `public_html`, tạo một thư mục mới tên **`media`**.

> Nếu anh dùng tên miền phụ (subdomain) riêng cho việc này thì thư mục sẽ nằm ở chỗ khác — cứ nhớ đường dẫn đầy đủ, lát nữa cần điền.

### 1.2. Lấy thông tin FTP

hPanel → **Trang web** → chọn website → **Tệp** → **Tài khoản FTP**

Ở đó có sẵn:

| Cần lấy | Hostinger hiển thị là |
|---|---|
| **FTP host** | *Máy chủ FTP* / *FTP hostname* — dạng `ftp.tenmien.com` hoặc một địa chỉ IP |
| **FTP username** | *Tên người dùng FTP* — dạng `u123456789.tenmien` |
| **Port** | Thường là **21** |

**Mật khẩu:** nếu anh không nhớ, bấm **Thay đổi mật khẩu tài khoản FTP** để đặt mật khẩu mới. Đặt xong dùng luôn, đừng lưu ở đâu khác.

> **Nên tạo một tài khoản FTP RIÊNG** chỉ trỏ vào thư mục `media`, thay vì dùng tài khoản chính. Nếu mật khẩu này lộ, kẻ lấy được cũng chỉ chạm tới được thư mục ảnh, không phải cả website. Hostinger cho tạo thêm tài khoản FTP ngay ở màn hình đó.

### 1.3. Kiểm tra thư mục mở được từ internet

Mở tab mới, vào `https://tenmien.com/media/`

Thấy trang trắng hoặc danh sách trống là **được**. Thấy lỗi 404 nghĩa là đường dẫn sai — quay lại bước 1.1.

Bước này quan trọng: Facebook và Instagram sẽ **tự tải ảnh về từ địa chỉ này**. Máy chủ của họ không đăng nhập được, nên thư mục phải mở công khai.

---

## Phần 2 — Điền vào Lumio

Đăng nhập tài khoản **Super Admin** → ở trang **Salons (Tenants)** bấm nút **Cài đặt hệ thống** → kéo xuống cuối trang, mục **🖼 Image storage (Hostinger / FTP)**.

> Nút này trước đây tên là *"Payment gateways"* nên không ai tìm ra kho lưu ảnh ở đó. Đã đổi tên, và đầu trang có sẵn link nhảy thẳng xuống mục kho ảnh.

Điền đúng 6 ô:

| Ô | Điền gì | Ví dụ |
|---|---|---|
| **Public URL of the upload folder** | Địa chỉ web của thư mục ở bước 1.3 | `https://tenmien.com/media` |
| **FTP host** | Lấy ở bước 1.2 | `ftp.tenmien.com` |
| **Port** | Gần như luôn là 21 | `21` |
| **FTP username** | Lấy ở bước 1.2 | `u123456789.media` |
| **FTP password** | Gõ thẳng vào đây | — |
| **Folder path on the server** | Đường dẫn thư mục **trên máy chủ**, không phải địa chỉ web | `/public_html/media` |

**Tick ô "Use FTPS (secure)"** — Hostinger hỗ trợ, và không tick nghĩa là mật khẩu đi qua mạng dưới dạng chữ thường.

Bấm **Save storage**, rồi bấm **Test connection**.

- **✓ Connected to ftp…** → xong.
- **✕ …** → xem phần cuối.

---

## Phần 3 — Thử thật

1. Vào một tiệm bất kỳ → **Kế hoạch & bài đăng** → **Post schedule** → **+ New post**
2. Bấm **📷 Tải ảnh lên**, chọn một tấm ảnh
3. Ảnh hiện ra trong danh sách → bấm vào link ảnh đó, phải mở được ở tab mới
4. Bấm **🚀 Đăng ngay**

Vào Trình quản lý tệp của Hostinger, trong `media` sẽ thấy một thư mục tên là mã tiệm, ảnh nằm trong đó. **Mỗi tiệm một thư mục riêng** — tiệm này không bao giờ thấy ảnh tiệm kia.

---

## Sau đó hệ thống tự lo những gì

- **Nén ảnh ngay trên máy khách** trước khi tải lên: mỗi tấm còn khoảng 300–600KB, rộng tối đa 1440px (Instagram hiển thị ở 1080 nên thừa nét).
- **Tự xoá ảnh 30 ngày sau khi bài đã đăng.** Facebook và Instagram giữ bản sao riêng nên bài không hề bị ảnh hưởng. Dung lượng vì thế **đứng yên** thay vì tăng mãi — ước tính 100 tiệm × 30 bài/tháng chỉ chiếm khoảng 1,5 GB liên tục.
- **Không đụng tới ảnh không phải của mình.** Tiệm nào dán link từ website riêng thì Lumio để nguyên.
- Ảnh của bài chưa đăng **không bao giờ bị xoá**, kể cả khi hẹn lịch trước 30 ngày.

Muốn đổi thời gian giữ: đặt biến môi trường `MEDIA_RETENTION_DAYS` trên Render (mặc định 30).

---

## Video

**Không tải video lên Lumio được** — đường upload hiện tại nhận ảnh nén, chặn ở 3MB, còn video điện thoại nặng 20–50MB.

Cách làm với video: tải file `.mp4` lên chính thư mục `media` trên Hostinger bằng Trình quản lý tệp, rồi dán địa chỉ đầy đủ vào ô link, ví dụ `https://tenmien.com/media/mong-gel.mp4`.

Link phải trỏ **thẳng tới file**. Mở link đó lên phải là video chạy ngay, không có giao diện web nào bao quanh. Link Google Drive, Google Photos, Dropbox share, OneDrive **đều không dùng được** — chúng là trang web, không phải file.

---

## Khi Test connection báo lỗi

| Báo lỗi | Nguyên nhân thường gặp |
|---|---|
| `530` hoặc *Login incorrect* | Sai tên đăng nhập hoặc mật khẩu. Tên FTP Hostinger có dạng `u123456789.something`, không phải email. |
| `ECONNREFUSED` / *timeout* | Sai host hoặc sai port. Thử bỏ tick FTPS xem có qua không — nếu qua thì máy chủ chưa bật TLS. |
| `550` hoặc *No such directory* | Sai **Folder path on the server**. Phải là đường dẫn hệ thống (`/public_html/media`), không phải `https://…`. |
| Kết nối OK nhưng ảnh không mở được | Sai **Public URL**. Kiểm tra lại bước 1.3. |

Còn vướng thì chụp màn hình phần báo lỗi gửi tôi — **nhớ che ô mật khẩu**.
