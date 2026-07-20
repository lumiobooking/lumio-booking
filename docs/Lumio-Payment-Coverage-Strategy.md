# Lumio Payment — Chiến lược phủ sóng nhiều provider & nhiều tệp khách

> Mục tiêu: tiệm đang **cầm sẵn máy/nhà cung cấp nào cũng cắm vào Lumio được**,
> không ép họ đổi. Tài liệu này nói thật: cái gì XONG, cái gì thêm dễ, cái gì là
> **rào cản thật** — và thứ tự làm để phủ nhiều khách nhất trên mỗi đơn vị công sức.

---

## 1. Ma trận phủ sóng (thị trường tiệm nail US & Canada)

| Nhà cung cấp | Cloud/WiFi | USB (Bridge) | Bluetooth (Companion) | Tệp khách điển hình |
|---|---|---|---|---|
| **Helcim** | ✅ **XONG** | – (máy chạy WiFi, không cần) | ⚠️ | All-in-one, phí tốt, US+CA, Interac |
| **Stripe** | ✅ **XONG** | ❌ không có SDK Windows | 🔶 code nền có, cần build app | Tiệm hiện đại, quen công nghệ |
| **Square** | ✅ **XONG** | ❌ | 🔶 cần thêm Square mobile SDK | **Rất phổ biến** |
| **SumUp** | ✅ **XONG** | ❌ | 🔶 cần thêm SumUp mobile SDK | Tiệm nhỏ, chi phí thấp |
| **Adyen** | ✅ **XONG** | ✅ Local Terminal API | ⚠️ | Chuỗi lớn / nhiều chi nhánh |
| **Clover** | ❌ *theo quy tắc hiện tại* | ❌ | ❌ | ⚠️ **RẤT phổ biến ở tiệm nail** |
| **PAX / Dejavoo / Valor** (qua Datacap/gateway) | – | 🔶 cần 1 driver Bridge | – | Tiệm có sẵn merchant services cũ |
| **Máy bất kỳ khác** | – | – | – | ✅ **Manual mode** (xem mục 3) |

**Đọc bảng:** ✅ dùng được ngay · 🔶 làm được, cần thêm việc · ❌ rào cản thật · ⚠️ có nhưng chưa ưu tiên

> **Đặt cọc online đã chạy thật với Helcim** (trước đây luồng này chạy qua mock = tiền ảo).
>
> **Tầng Cloud/WiFi đã HOÀN TẤT: 5 provider** — Helcim · Stripe · Square · SumUp · Adyen.
> Cộng với **Manual mode**, mọi tiệm đều onboard được ngay hôm nay.

---

## 2. Hai rào cản THẬT (không phải do lười làm)

**a) Clover — gap phủ sóng LỚN NHẤT cho tiệm nail.**
Rất nhiều tiệm nail Mỹ đang xài Clover. Nhưng để điều khiển máy Clover, Clover **bắt
buộc** phải có một **app semi-integration + RAID, cài từ App Market**. Nghĩa là **Lumio
phải đăng ký/publish 1 app** — đúng thứ anh đã yêu cầu *"tuyệt đối không đăng ký gì"*.

> **Cần anh quyết:** có chấp nhận **ngoại lệ** này không? Lưu ý: đó là **developer app
> (miễn phí, chỉ là danh tính app)** — **KHÔNG phải tài khoản merchant, KHÔNG KYC tiền,
> Lumio vẫn không giữ tiền**. Nếu chấp nhận → mở khoá cả một tệp khách rất lớn.
> Nếu không → tệp Clover chỉ dùng được **Manual mode**.

**b) USB trên Windows — phải chọn processor.**
Stripe/Square/SumUp/Helcim **không có SDK Windows**. USB thật chỉ có với **Adyen Local**
hoặc dòng **PAX/Dejavoo/Valor qua Datacap/gateway**. Bridge đã xong và đã test E2E;
chỉ còn **1 file driver** cho dòng máy được chọn.

---

## 3. Lưới an toàn: Manual mode (đã chạy sẵn)

Tiệm dùng máy Lumio **chưa** điều khiển được vẫn onboard bình thường: ở POS chọn
**CARD**, quẹt trên máy của tiệm, hệ thống **vẫn ghi nhận doanh thu, tip, báo cáo,
lương thợ**. Không ai bị chặn — chỉ là chưa tự động đẩy số tiền xuống máy.

→ **Coverage thực tế của Lumio hôm nay = 100% tiệm** (manual), trong đó **4 provider**
đã tự động hoá hoàn toàn.

---

## 4. Thứ tự đề xuất (nhiều khách nhất / công sức bỏ ra)

| Ưu tiên | Việc | Vì sao |
|---|---|---|
| **1** | **Clover** *(nếu anh duyệt ngoại lệ)* | Mở tệp khách lớn nhất của thị trường nail |
| ~~2~~ | ~~Adyen Cloud connector~~ ✅ **ĐÃ XONG** | Tầng Cloud giờ đủ **5 provider** |
| **3** | **Companion đa provider** (Stripe + Square + SumUp Bluetooth) | Dùng lại relay đã có; phủ tiệm muốn thu tiền tại ghế |
| **4** | **Bridge driver** cho PAX/Datacap | Phủ tiệm có merchant services cũ |
| ~~5~~ | ~~Online / đặt cọc~~ ✅ **XONG với Helcim** (HelcimPay.js, xác thực phía server). Còn Stripe/Square online nếu cần | Đặt cọc booking, chống no-show |

---

## 5. Nguyên tắc kiến trúc đã đảm bảo sẵn

- Thêm 1 provider = **thêm 1 connector** (không sửa POS/Order/Orchestrator).
- Thêm 1 máy USB = **thêm 1 driver** trong `bridge/src/drivers/`.
- Thêm 1 máy Bluetooth = **thêm 1 SDK** trong Companion.
- Mỗi tiệm **tự chọn provider + connection type** trong Settings; loại nào chưa hỗ trợ
  thì ẩn/ghi rõ lý do, không đánh lừa.
- Tiệm **tự dán API key của chính họ** — Lumio không giữ tiền, không giữ tài khoản.

---

## 6. Cần anh chốt

1. **Clover:** duyệt ngoại lệ đăng ký developer app (miễn phí, không KYC) — có / không?
2. **USB:** đi **PAX/Datacap** (hợp tiệm nail Mỹ) hay **Adyen Local** (chuỗi lớn)?
3. **Ưu tiên kế tiếp:** làm Adyen Cloud trước, hay Companion đa provider trước?
