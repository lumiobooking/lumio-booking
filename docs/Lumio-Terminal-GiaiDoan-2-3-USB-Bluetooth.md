# Giai đoạn 2 (USB) & 3 (Bluetooth) — kế hoạch dựa trên tài liệu chính thức

> Ngày: 21/07/2026 · **Chưa code.** Giai đoạn 1 chưa qua kiểm thử thực tế, đúng theo
> quy tắc đã chốt: *"Sau khi SPIn Cloud đạt đầy đủ acceptance criteria và kiểm thử
> thực tế thành công, mới bắt đầu giai đoạn USB."*
>
> Tài liệu này trả lời câu hỏi **phải trả lời trước khi code**: model nào có SDK
> chính thức, và giao thức thật sự là gì.

---

## TÓM TẮT — hai phát hiện làm đổi kế hoạch

**1. USB của Dejavoo chỉ hỗ trợ P17, KHÔNG hỗ trợ P1.**
Trang SPIn USB của Dejavoo ghi thẳng mục *Supported Terminals: **Dejavoo P17***.
Máy P1 của khách anh có cổng USB, nhưng USB đó dành cho thiết bị ngoại vi
(máy in, quét mã), không phải để POS điều khiển máy. Nghĩa là **giai đoạn 2 không
phục vụ được khách hàng hiện tại** — họ phải mua thêm P17.

**2. Bluetooth có thể là việc không cần làm.**
Dejavoo **không có** đường Bluetooth cho POS bên thứ ba. Đường Bluetooth duy nhất
có SDK chính thức là Stripe, mà Stripe lại buộc tiệm phải mở tài khoản Stripe —
tức là đổi luôn nhà xử lý thẻ. Trong khi đó nhu cầu thật ("thu tiền tại ghế") đã
giải quyết được **ngay hôm nay, không cần dòng code nào**: dòng P không dây của
Dejavoo (**P3, P8, P18**) chạy WiFi và đi qua **SPIn Cloud** — thứ đã xây xong.

➜ Đề xuất: **giữ giai đoạn 2 (USB), cân nhắc bỏ hoặc hoãn vô thời hạn giai đoạn 3.**

---

## PHẦN A — Giai đoạn 2: SPIn USB

### A1. Điều kiện phần cứng

| Hạng mục | Yêu cầu (nguyên văn tài liệu Dejavoo) |
|---|---|
| Máy hỗ trợ | **Dejavoo P17** (chỉ mình model này được liệt kê) |
| Máy chủ POS | Thiết bị có cổng USB · tài liệu ghi *"USB cable compatible with Windows"* |
| Đấu nối | P17 kèm sẵn USB hub 2 cổng USB-C: một cổng **POWER**, một cổng **USB-C** nối vào máy tính quầy |

### A2. Hai chế độ — chế độ thứ hai mới là thứ đáng làm

- **SPIn USB** — USB là kênh chính. Dùng khi tiệm không có mạng ổn định.
- **SPIn USB as Fallback** — **Cloud là chính, tự chuyển sang USB khi mất mạng.**
  Đây mới là giá trị thật với tiệm nail: WiFi tiệm hay chập chờn, mất mạng giữa
  ca là mất doanh thu. Chế độ này giữ nguyên luồng Cloud đã xây, chỉ thêm đường
  cứu hộ.

Dejavoo ghi rõ: hai chế độ dùng **chung một khung giao tiếp USB, chung định dạng
request/response** — chỉ khác ở cấu hình trong cổng iPOSpays. Nghĩa là code một
lần dùng được cả hai.

Tài liệu cũng nói SPIn USB là lựa chọn khuyến nghị cho **Offline Mode**, nhưng
Offline Mode phải được bật riêng cho TPN.

### A3. Ai cấu hình — đây là điểm vướng

Cấu hình USB **chủ tiệm KHÔNG tự làm được**. Phải là tài khoản **ISO Admin**:

```
iPOSpays → Merchants → chọn tiệm → Devices → chọn TPN → Edit Param → Integration
   SPIn USB:          Type of Integration = SPIn,  SPIn Mode = USB
   USB as Fallback:   Type of Integration = SPIn,  SPIn Mode = Cloud,  bật USB Fallback
→ Save → cập nhật parameter trên máy
```

➜ Mỗi tiệm muốn dùng USB đều phải nhờ ISO. Khác hẳn Cloud (tiệm tự tạo token
trong 2 phút). Cần tính vào quy trình bán hàng và hỗ trợ.

### A4. Giao thức — KHÁC hẳn Cloud, không dùng lại code được

USB **không phải** REST/JSON. Là **XML qua cổng serial**.

```
Baud 115200 · 8 data bits · 1 stop bit · no parity
Gửi:  chuỗi XML + "\r\n"
Nhận: đọc tới khi gặp "</xmp>"  (timeout đọc 120 giây)
```

Request:

```xml
<request>
  <TransType>Sale</TransType>
  <PaymentType>Credit</PaymentType>
  <Amount>103.00</Amount>
  <Tip>0.00</Tip>
  <RegisterId>1234</RegisterId>
  <AuthKey>vPXjq5X8fn</AuthKey>
  <PrintReceipt>No</PrintReceipt>
  <SigCapture>No</SigCapture>
  <RefId>DL637766455727</RefId>
</request>
```

**Bẫy — tên field khác Cloud, dễ bê nhầm:**

| Việc | Cloud REST | USB XML |
|---|---|---|
| ID giao dịch | `ReferenceId` | **`RefId`** |
| Khoá xác thực | `Authkey` (k thường) | **`AuthKey`** (K hoa) |
| Định danh máy | `Tpn` (RegisterId đã obsolete) | **`RegisterId` BẮT BUỘC**, không có Tpn |
| Loại lệnh | nằm ở đường dẫn URL | **`TransType`** trong body |
| Tip | `TipAmount` | **`Tip`** |
| Kết quả | `GeneralResponse.StatusCode` 4 số | **`ResultCode`** (`0` = thành công) |

Response bọc trong `<xmp><response>`, có `AuthCode`, `PNRef`, `TransNum`,
`ResultCode`, `Voided`, `SN`, và một khối **`ExtData`** dạng `key=value` phân
tách bằng dấu phẩy (chứa `Tip`, `BatchNum`, `AcntLast4`, `CardType`, `RRN`,
`EntryType`, `TotalAmt`, `DateTime`…) — phải tự tách chuỗi, không phải JSON.

**Điểm sáng:** `ExtData.DateTime` có thời gian giao dịch — thứ mà Cloud REST
thiếu hoàn toàn.

### A5. Việc thật sự phải làm

| # | Việc | Ghi chú |
|---|---|---|
| 1 | `DejavooUsbDriver` trong Bridge (Node) | Dùng `serialport`; Bridge hiện là zero-dependency nên đây là dependency đầu tiên |
| 2 | Bộ dựng + đọc XML SPIn | Không dùng lại được connector Cloud; map field theo bảng A4 |
| 3 | Bật `UsbTerminalAdapter` | Khung đã có, chỉ điền ruột |
| 4 | Logic fallback | Cloud lỗi mạng → thử USB → **vẫn phải Status-check trước khi thử lại**, nếu không sẽ charge 2 lần qua hai đường |
| 5 | Chuẩn hoá `RefId` chung | Một mã dùng cho cả hai đường, nếu không Cloud và USB sẽ đếm thành hai giao dịch |
| 6 | Kiểm chứng serial trên Windows | Dejavoo chỉ đưa mẫu code Android (`usb-serial-for-android`, Kotlin). Phần cứng có ghi hỗ trợ Windows nhưng **chưa ai chứng minh** — đây là rủi ro kỹ thuật lớn nhất của giai đoạn 2 |
| 7 | Test rút cáp giữa giao dịch | Trạng thái Disconnected phải ra `UNKNOWN`, không phải `FAILED` |

**Không mua P17 thì không test được.** Đây là chi phí bắt buộc trước khi code —
viết mù rồi test sau sẽ tốn hơn nhiều.

---

## PHẦN B — Giai đoạn 3: Bluetooth

### B1. Dejavoo không có đường này

Dejavoo không cung cấp SDK Bluetooth cho POS bên thứ ba. Thứ họ có là **Tap to
Pay on Android/iPhone SDK** và **DvPayLite deep linking** — cả hai đều là "app
của Lumio gọi app của Dejavoo trên cùng một máy", không phải Bluetooth tới máy
cà thẻ rời.

### B2. Stripe — có SDK chính thức, nhưng vướng thị trường

| Máy | Bán ở | React Native SDK |
|---|---|---|
| **Stripe Reader M2** | **Chỉ Mỹ** | ✅ |
| **BBPOS WisePad 3** | Canada + 27 nước — **KHÔNG có Mỹ** | ✅ |

➜ Phủ được cả Mỹ và Canada thì phải hỗ trợ **hai model khác nhau**.
Từ 11/2025 WisePad 3 dùng kiểu ghép Bluetooth *numeric comparison* — phải xác
nhận mã trên cả máy cà thẻ lẫn điện thoại, thêm một bước cho người dùng.

**Vướng lớn hơn về kinh doanh:** đi đường này tiệm phải mở **tài khoản Stripe**,
tức là đổi nhà xử lý thẻ. Tiệm đang dùng Dejavoo sẽ phải chạy song song hai hệ
thống, hai bảng đối soát, hai lần chốt sổ. Rất khó thuyết phục.

### B3. Vì sao nên hoãn — và làm gì thay thế

Nhu cầu thật của tiệm không phải "Bluetooth", mà là **"thu tiền ngay tại ghế"**.

Dejavoo có sẵn máy không dây chạy WiFi: **P3, P8, P18**. Chúng đi qua **SPIn
Cloud** — nghĩa là **Lumio hỗ trợ được ngay hôm nay, không cần viết thêm gì**.
Tiệm mua thêm một máy không dây, khai TPN vào Lumio như máy thường, xong.

| | Bluetooth (Stripe) | Máy không dây (Dejavoo, WiFi) |
|---|---|---|
| Code phải viết | React Native SDK, ghép máy, quản lý pin | **Không** |
| Tiệm phải làm | Mở tài khoản Stripe, đổi processor | Mua thêm máy, xin TPN |
| Đối soát | Hai hệ thống tách rời | Một hệ thống |
| Sẵn sàng | Còn xa | **Ngay** |

➜ Đề xuất: **bỏ Bluetooth khỏi lộ trình**, thay bằng một dòng hướng dẫn bán hàng
"muốn thu tiền tại ghế thì dùng máy Dejavoo không dây". Chỉ mở lại nếu có khách
hàng cụ thể yêu cầu và họ đã dùng Stripe sẵn.

---

## PHẦN C — Thứ tự đề xuất sau khi giai đoạn 1 đạt

1. **Chạy hết kịch bản kiểm thử giai đoạn 1** trên máy P1 thật. Chưa xong bước này thì mọi thứ dưới đây đều là bàn suông.
2. **Mua một P17** + nhờ ISO bật SPIn USB Fallback trên TPN test.
3. **Chứng minh serial trên Windows** — chỉ cần mở cổng, gửi một lệnh Sale, đọc được `</xmp>`. Nếu bước này thất bại, cân nhắc chuyển Bridge sang Android tablet thay vì máy tính Windows.
4. Viết `DejavooUsbDriver` + bộ XML, bật `UsbTerminalAdapter`.
5. Test rút cáp, mất mạng, fallback qua lại.
6. Bluetooth: **hoãn**, xem lại khi có yêu cầu thật.

---

## Nguồn

- Dejavoo SPIn USB — https://docs.ipospays.com/spin-specification/spin-usb-as-fallback
- Dejavoo SPIn (tổng quan) — https://docs.ipospays.com/spin-specification
- Dejavoo dòng P — https://dejavoo.io/products/p-terminals-family/
- Stripe BBPOS WisePad 3 — https://docs.stripe.com/terminal/readers/bbpos-wisepad3
- Stripe mobile readers — https://docs.stripe.com/terminal/bluetooth-readers
