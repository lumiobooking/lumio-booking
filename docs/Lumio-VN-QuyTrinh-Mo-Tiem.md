# Mở một tiệm Việt Nam — quy trình vận hành

Ngày lập: 20/08/2026.

Tài liệu này mô tả **đúng những gì hệ thống làm được hôm nay**. Phần cuối liệt kê những thứ **chưa có** — đọc phần đó trước khi hứa với khách.

**Nguyên tắc nền:** tiệm Việt Nam và tiệm Mỹ nằm chung một hệ thống, nhưng **không tiệm nào nhìn thấy tiệm nào** — kể cả hai tiệm Mỹ cạnh nhau cũng vậy. Đó là cách phần mềm này được xây từ đầu: mọi bảng dữ liệu đều gắn mã tiệm, mọi câu truy vấn đều lọc theo tiệm đang đăng nhập. "Thị trường" chỉ là **một ô chọn trên hồ sơ tiệm**, giống múi giờ hay gói cước.

---

# PHẦN A — Việc của bạn (Super Admin). Khoảng 5 phút.

### A1. Vào `lumiobooking.com` → đăng nhập → **Super Admin → Tenants**

### A2. Bấm **Create a new salon**, điền:

| Ô | Điền gì | Ghi chú |
|---|---|---|
| **Salon name** | Tên tiệm | Hệ thống tự sinh đường dẫn từ tên này |
| **Market** | **🇻🇳 Việt Nam** | ← **ô quan trọng nhất** |
| Timezone | *tự nhảy sang Asia/Ho_Chi_Minh* | Chọn Market xong nó tự đổi |
| Salon admin email | Email chủ tiệm | Đây là tài khoản đăng nhập của họ |
| Salon admin password | Tối thiểu 8 ký tự | Đặt tạm, bảo họ đổi ngay |
| Plan | Gói đã bán | Để trống được, tính sau |

### A3. Bấm tạo. **Hệ thống tự cấu hình luôn** — bạn không phải vào sửa gì thêm:

- Tiền tệ **VND**, **không số lẻ**, ký hiệu **₫ đứng sau số**
- Quốc gia **VN** → số điện thoại tự hiểu đầu **+84**, ngày giờ theo định dạng Việt
- **Tắt tiền tip**
- Múi giờ Việt Nam
- Chủ tiệm đăng nhập lần đầu là **dashboard hiện tiếng Việt luôn**

> Đây chính là phần trước đây phải đi sửa tay ở ba màn hình khác nhau. Sai một cái là hỏng thật: sai múi giờ thì khách bị đặt nhầm giờ, thiếu "không số lẻ" thì **200.000₫ hiện thành ₫2.000**.

### A4. Bấm **Edit** trên dòng tiệm vừa tạo → kéo xuống **🔒 Feature access**

Tick những tính năng bạn **đã bán** cho tiệm đó. Mặc định **tất cả đều tắt** — bán tới đâu mở tới đó.

Hai dòng **AI Hotline** và **Payment terminals** sẽ **tự mờ đi, ghi "Not available in this market"**. Không phải lỗi: bot điện thoại nói tiếng Anh trên số Twilio Mỹ, còn máy quẹt thẻ là phần cứng Bắc Mỹ. Không bán được ở Việt Nam, nên hệ thống không cho tick nhầm.

### A5. Gửi cho chủ tiệm

```
Địa chỉ:  https://lumiobooking.com/login
Email:    (email vừa tạo)
Mật khẩu: (mật khẩu tạm — đổi ngay sau khi vào)
```

**Xong phần bạn.** Muốn xem lại danh sách tiệm Việt Nam: ở trang Tenants chọn bộ lọc **🇻🇳 Việt Nam**, tiệm Mỹ biến khỏi màn hình.

---

# PHẦN B — Việc của chủ tiệm. Khoảng 30–60 phút.

**Thứ tự này bắt buộc** — bước sau cần bước trước mới chạy được.

### B1. Đổi mật khẩu
**Tài khoản** (góc trên phải) → đổi mật khẩu.

### B2. Nhập dịch vụ và giá — **quan trọng nhất**
**Dịch vụ** → thêm từng món: tên, thời lượng, giá.

> **Gõ giá là gõ số trơn: `200000`.** Không gõ `200.000`, không gõ `200,000`, không gõ `200k`. Màn hình sẽ tự hiện lại thành `200.000 ₫`.

**Chưa có dịch vụ thì trang đặt lịch không hiện gì cả.** Đây là lý do bước này đứng trước.

### B3. Thêm thợ
**Nhân viên** → thêm từng người → đặt **giờ làm việc** cho mỗi người.

Khách chỉ đặt được vào giờ **có thợ rảnh**. Không khai giờ làm thì lịch trống trơn.

### B4. Giờ mở cửa tiệm
**Cài đặt → Đặt lịch** → khai giờ mở/đóng từng ngày trong tuần.

### B5. Thông tin tiệm
**Cài đặt → Thông tin doanh nghiệp** → tên, địa chỉ, số điện thoại.

Phần này hiện trên trang đặt lịch cho khách xem.

### B6. Thanh toán chuyển khoản
**Cài đặt → Thanh toán** → hai ô:

- **Hướng dẫn chuyển khoản** — gõ tên ngân hàng, số tài khoản, tên chủ tài khoản
- **Ảnh mã QR** — dán link ảnh mã **VietQR** của tiệm

Lúc thu ngân chọn Chuyển khoản / VietQR / MoMo / ZaloPay, màn hình sẽ **hiện mã này lên cho khách quét**.

### B7. Chọn nút hiện trên máy tính tiền
Mặc định tiệm Việt Nam có **6 nút**: Tiền mặt · Thẻ · Chuyển khoản · VietQR · MoMo · ZaloPay.

Tiệm không nhận MoMo thì **bỏ nút MoMo đi** — cuối ngày mệt, ít nút thì ít bấm nhầm.

---

# PHẦN C — Đưa khách vào

### C1. Link đặt lịch — dùng được ngay, không cần website

```
https://lumiobooking.com/<đường-dẫn-tiệm>
```

Xem đường dẫn chính xác ở nút **Chia sẻ link đặt lịch** trong dashboard.

Dán link này vào: **trang Facebook**, **Zalo OA**, **Google Maps**, tin nhắn, in lên card.

### C2. Nếu tiệm có website WordPress

**Kết nối** → tạo **API key** → cài plugin Lumio trên WordPress → dán key vào.

Trang đặt lịch nhúng thẳng vào website tiệm. Mỗi tiệm một key riêng.

---

# PHẦN D — In bill tại quầy *(tuỳ chọn)*

1. Cài **print-agent** lên máy tính ở quầy lễ tân (máy Windows)
2. Dashboard → **Kết nối** → tạo **API key** → copy
3. Dán key vào file `config.json` của print-agent
4. Chạy `start.bat`
5. Lúc thanh toán, thu ngân tick **"In tại quầy lễ tân"**

> ⚠️ **Chưa kiểm chứng: dấu tiếng Việt trên máy in nhiệt.**
> Chương trình in đang đẩy chữ qua driver Windows, **không điều khiển bảng mã**. Chữ "Thanh toán" có thể ra "Thanh toan" mất dấu, hoặc ra ký tự lạ — **tuỳ máy in**.
> **Phải cắm máy in thật in thử một tờ trước khi bàn giao cho tiệm.** In thử ra sai thì báo tôi, tôi chuyển sang chuẩn ESC/POS.

---

# PHẦN E — Chạy hằng ngày

```
Khách bấm link đặt lịch
        ↓
Hiện trong Lịch hẹn của tiệm
        ↓
Khách tới, làm xong
        ↓
Thu ngân → chọn dịch vụ → chọn thợ → chọn cách trả tiền
        ↓
Khách quét QR / đưa tiền mặt → xác nhận → in bill
        ↓
Cuối ngày: Báo cáo → xem tách riêng từng nguồn tiền
        (tiền mặt bao nhiêu, VietQR bao nhiêu, MoMo bao nhiêu)
```

---

# PHẦN F — Những thứ CHƯA CÓ ở thị trường Việt Nam

**Đọc phần này trước khi báo giá.** Hứa nhầm rồi mới biết là mất khách.

| Hạng mục | Tình trạng | Nói với khách thế nào |
|---|---|---|
| **Nhắc lịch tự động qua SMS** | ❌ Chưa | Twilio phủ Việt Nam kém và đắt. Hiện nhắc khách qua **Messenger** hoặc gọi tay |
| **Thanh toán online tự động** | ⚠️ Bán tự động | Mã VietQR là **ảnh tĩnh** — khách quét xong, **thu ngân phải tự mở app ngân hàng xem tiền vào rồi bấm xác nhận**. Hệ thống chưa tự đối soát |
| **AI Zalo chốt đơn** | ❌ Chưa làm | Cần dựng lại tầng nhắn tin (hiện đang gắn cứng vào Facebook). Chưa có ngày |
| **Bot Messenger** | ✅ Có | Chạy được, đã bán được |
| **Bill in ra** | ⚠️ Một nửa | **Số tiền đúng**, nhưng nhãn còn tiếng Anh (`RECEIPT`, `TOTAL`). Chưa in tên tiệm/địa chỉ/MST |
| **Hoá đơn VAT** | ❌ Chưa | Thuế đang tính kiểu Mỹ: **cộng thêm** vào giá, và **không đánh vào dịch vụ**. VAT Việt Nam thì ngược lại |
| **AI Hotline (bot điện thoại)** | ❌ Không bán ở VN | Hệ thống tự chặn, không tick được |
| **Máy quẹt thẻ** | ❌ Không bán ở VN | Phần cứng Bắc Mỹ. Hệ thống tự chặn |

---

# Tra lỗi nhanh

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Trang đặt lịch trống trơn | Chưa nhập dịch vụ (B2) |
| Có dịch vụ nhưng không chọn được giờ nào | Chưa khai giờ làm của thợ (B3) hoặc giờ mở cửa (B4) |
| Giá hiện sai gấp 100 lần | Gõ giá có dấu chấm/phẩy. Gõ lại số trơn `200000` |
| Chọn VietQR mà không thấy mã | Chưa dán link ảnh QR (B6) |
| Dashboard ra tiếng Anh | Chủ tiệm từng bấm đổi sang English. Đổi lại ở góc trên |
| Bill in ra mất dấu | Vấn đề bảng mã máy in — xem Phần D |
