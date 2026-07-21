# Giai đoạn 1 — Dejavoo P1 qua iPOSpays SPIn Cloud

> Trạng thái: **code xong, unit test xong (21/21 pass), chưa test trên máy thật.**
> Ngày: 21/07/2026 · Đặc tả gốc: `Lumio-Dejavoo-SPIn-API-Reference.md`

---

## 1. Kiến trúc — adapter, không phải sửa hệ thống

Toàn bộ máy quẹt thẻ giờ nói chung một hợp đồng: `TerminalAdapter`
(`apps/api/src/payments-hub/adapters/terminal-adapter.interface.ts`), đúng 9 phương thức
anh yêu cầu:

```
connect()          disconnect()       testConnection()
getCapabilities()  createPayment()    getPaymentStatus()
cancelPayment()    voidPayment()      refundPayment()
```

| Adapter | Trạng thái | Ghi chú |
|---|---|---|
| `DejavooSpinCloudAdapter` | ✅ **Hoàn chỉnh** | Giai đoạn 1 |
| `StripeTerminalAdapter` | 🔒 `enabled: false` | Bọc connector Stripe đã chạy từ trước |
| `SquareTerminalAdapter` | 🔒 `enabled: false` | Bọc connector Square đã chạy từ trước |
| `UsbTerminalAdapter` | 🔒 `enabled: false` | Khung rỗng — giai đoạn 2 |
| `BluetoothTerminalAdapter` | 🔒 `enabled: false` | Khung rỗng — giai đoạn 3 |

`ProviderRegistry.adapter()` **từ chối trả về adapter chưa bật**, kể cả khi ai đó gọi
thẳng API bằng provider id. Giao diện tiệm cũng chỉ hiện Cloud
(`NEXT_PUBLIC_TERMINAL_USB_ENABLED` mặc định tắt). Tiệm không bao giờ nhìn thấy
một đường thanh toán làm dở.

---

## 2. Tiệm cần làm gì (3 bước, không cần Lumio can thiệp)

1. **Lấy TPN** — hỏi ISO của tiệm. Không có TPN thì email `devsupport@dejavoo.io`.
2. **Bật chế độ SPIn** (semi-integrated) cho TPN đó — nhờ ISO làm.
3. **Tạo Auth Key** — cổng iPOSpays → `Settings` → `Generate Ecom/TOP Merchant Keys`
   → chọn TPN → `Generate Token`. Token 10 ký tự.

Rồi vào Lumio: **Settings → Card terminals → Dejavoo / iPOSpays** → dán TPN + Auth Key →
chọn môi trường → **Connect**. Nút Connect gọi thẳng `GET /v2/Common/TerminalStatus`,
nên nếu máy chưa online là biết ngay.

Thêm máy thứ 2, thứ 3: mục **Card readers → Add reader**, nhập TPN của máy đó.
Mỗi TPN là một `PaymentDevice` riêng, có `tenantId` riêng.

Thêm máy thứ 2, thứ 3 (kể cả ở cơ sở khác): **Card readers → Add reader** → nhập
**TPN**, tên gợi nhớ, **cơ sở**, và **Auth Key riêng của máy đó** nếu có.

> iPOSpays cấp **một Auth Key cho mỗi TPN**, nên tiệm 2 cơ sở thường có 2 key khác
> nhau. Key riêng được mã hoá AES-256-GCM lưu ngay trên bản ghi máy đó
> (`payment_devices.credentialEnc`). Bỏ trống ô này thì máy dùng chung key của
> tài khoản.

Mỗi máy có nút **Test** riêng — với nhiều máy nhiều cơ sở, câu hỏi hữu ích không phải
"kết nối có ổn không" mà là "máy nào đang chết".

---

## 3. Chống charge 2 lần — 4 lớp

| Lớp | Cơ chế |
|---|---|
| 1. `clientRef` | `@@unique([tenantId, clientRef])`. Gửi lại y hệt → trả về intent cũ, **không gọi provider**. |
| 2. `ReferenceId` tất định | Sinh từ `clientRef` bằng hàm thuần. Cùng input → cùng ReferenceId → Dejavoo trả `1011 Duplicate` thay vì thu tiền lần nữa. Gặp 1011, connector tự gọi `Status` để đọc kết quả giao dịch đã có. |
| 3. Không bao giờ đoán "thất bại" | Timeout `2007`, mất kết nối `1030`, `2010`, hoặc socket đứt → trả **`UNKNOWN`**, không phải `DECLINED`. Chỉ `1001` / `2009` (không tìm thấy giao dịch) mới là an toàn để thu lại. |
| 4. Khoá theo đơn | Trước khi charge, nếu đơn đó còn intent chưa ngã ngũ, hệ thống hỏi lại provider; còn treo thì **từ chối charge** kèm thông báo cho thu ngân xem màn hình máy. |

Ngoài ra `externalIntentId` luôn được ghi **kể cả khi request đứt giữa chừng** —
không có nó thì vĩnh viễn không tra được thẻ đã bị trừ hay chưa.

---

## 3b. Thu ngân thấy gì khi máy không trả lời

Đây là chỗ dễ mất tiền nhất, nên xử lý riêng:

- POS chờ tới **150 giây** (máy Dejavoo mặc định chờ thẻ 120 giây). Trước đây POS
  chỉ chờ 60 giây rồi báo "Card not completed" **trong khi khách vẫn đang quẹt** —
  thu ngân thấy vậy sẽ bấm lại. Đã sửa.
- Hết thời gian mà máy vẫn im: POS **không ghi đơn**, không cho bấm lại, mà bật một
  bảng chặn màn hình: *"Khoan bấm thanh toán lại — hãy nhìn màn hình máy trước"*,
  kèm nút **Kiểm tra lại** (hỏi lại Dejavoo bằng ReferenceId cũ).
- Giao dịch chưa ngã ngũ được đẩy lên đầu trang **Card transactions** để chủ tiệm
  xử lý nốt, không bị trôi mất.

---

## 4. Dữ liệu lưu lại

`PaymentIntentRecord` + `providerRaw`: `AuthCode` (approval code), `ReferenceId`,
`BatchNumber`, `TransactionNumber`, `RRN`, `Amounts` (Amount / TipAmount / TotalAmount),
`CardData` (**chỉ** brand + last 4 + kiểu quẹt).

**Không lưu số thẻ.** Máy P1 tự mã hoá thẻ (P2PE) — số thẻ chưa bao giờ đi qua server Lumio.
Lumio nằm trong phạm vi PCI **SAQ A**.

⚠️ SPIn **không trả về timestamp** ở cấp root. Thời gian giao dịch dùng
`createdAt` / `succeededAt` của bản ghi Lumio.

Audit log: `payment.connect`, `payment.charge`, `payment.void`, `payment.refund` —
mỗi dòng có `tenantId`, `userId`, `action`, thời điểm.

---

## 5. Void vs Refund — khác nhau thật sự

| | Void | Refund (Return) |
|---|---|---|
| Khi nào | **Trước khi settle** (cùng ngày) | Sau khi đã settle |
| Tham chiếu | `ReferenceId` **gốc** + số tiền gốc | `ReferenceId` **MỚI** — Dejavoo coi Return là giao dịch độc lập |
| Một phần | Không | **Có** — hoàn bao nhiêu cũng được |
| Khách | Không cần có mặt | **Phải quẹt lại thẻ trên máy** |
| API Lumio | `POST /payments-hub/void` | `POST /payments-hub/refund` |

Chủ tiệm thao tác ở trang **Card transactions** (menu 🧾). Mỗi giao dịch hiện đủ
số tiền, tip, mã duyệt, hãng thẻ + 4 số cuối, batch — và chỉ hiện nút Huỷ hoặc
Hoàn tiền khi thao tác đó thật sự hợp lệ. Nút Huỷ biến mất sau khi đã hoàn một
phần, để không tạo ra hai đường sửa chồng nhau.

Quyền: chỉ **Salon Admin** hoặc **Super Admin** mới huỷ/hoàn được. Thợ không thấy.

Đây là ràng buộc của Dejavoo, không phải lựa chọn thiết kế: doc ghi rõ
*"Return is an independent operation and it does not relate to any Sale transaction."*

---

## 6. Cần kiểm chứng trên sandbox trước khi lên production

Ba điểm dưới đây tài liệu Dejavoo **không nói rõ**. Em code theo cách đọc hợp lý
nhất và đánh dấu sẵn trong code để dễ sửa:

1. **`Amount` đã gồm tip chưa?** — Doc gọi field này là *"Total amount of the transaction"*
   và response ghi `Amounts.Amount` = *"Amount with tip"*, nên em gửi **tổng đã gồm tip**.
   Hằng số `AMOUNT_INCLUDES_TIP` ở đầu file adapter. **Nếu sai, mọi giao dịch có tip sẽ
   thu thừa đúng bằng tiền tip** — đây là thứ phải test đầu tiên.
2. **`Content-Type`** — cURL mẫu của Dejavoo không hiện header nào. Em gửi
   `application/json`. Nếu server từ chối thì đổi sang form-encoded.
3. **Đơn vị `SPInProxyTimeout`** — doc không ghi (min 1, max 720). Em để `null` dùng
   mặc định 120 giây của máy.

Kịch bản test tối thiểu: Sale duyệt → Sale bị từ chối → khách bấm Cancel trên máy →
rút dây mạng giữa lúc Sale (kiểm tra timeout recovery) → Status check → Void trong ngày →
Refund một phần → 2 máy TPN khác nhau cùng một tiệm.

---

## 6b. Cấu hình khi lên production

| Biến môi trường | Đặt gì | Nếu thiếu |
|---|---|---|
| `PAYMENTS_HUB_ENABLED` | `true` | Toàn bộ tính năng tắt, hệ thống chạy y như trước |
| `PAYMENT_ENC_KEY` | Chuỗi hex 64 ký tự (32 byte) | Không lưu được credential — API trả 503, **không** lưu key dạng thô |
| `NEXT_PUBLIC_TERMINAL_USB_ENABLED` | **Không đặt** (hoặc `false`) | USB/Bluetooth hiện ra cho tiệm — chưa xong, đừng bật |

Đổi `PAYMENT_ENC_KEY` sau khi đã có tiệm kết nối sẽ làm **hỏng toàn bộ credential
đã lưu** — các tiệm phải nhập lại Auth Key. Đặt một lần rồi giữ nguyên.

Trong tiệm, mỗi máy nên chọn **Environment = Production**. Chỉ dùng **Sandbox**
với TPN test do Dejavoo cấp — hai môi trường dùng hai máy chủ khác nhau
(`spinpos.net` và `test.spinpos.net`), nhầm là ra lỗi `2003 Register not found`.

---

## 7. Kiểm thử đã chạy

| Bộ test | Kết quả |
|---|---|
| Adapter Dejavoo (21 ca) | ✅ 21/21 |
| Cô lập tenant + credential (7 ca) | ✅ 7/7 |
| Transpile toàn bộ payments-hub + POS + Settings + trang mới (31 file) | ✅ sạch |

File test trong repo: `apps/api/src/payments-hub/adapters/dejavoo-spin-cloud.adapter.spec.ts`
và `apps/api/src/payments-hub/credential-store.spec.ts`.

Các ca đáng chú ý: timeout `2007` phải ra `UNKNOWN` **chứ không phải** `DECLINED`;
trùng `ReferenceId` phải giải quyết bằng **một** lệnh Sale duy nhất rồi đọc `Status`;
tiệm A hỏi id máy của tiệm B thì **không lấy được key của B**.

Chưa chạy được trong sandbox: `prisma generate` và full `tsc` (giới hạn môi trường),
nên phần typecheck đầy đủ sẽ chạy khi anh `deploy.bat`.

---

## 8. Điều kiện để sang giai đoạn 2 (USB)

Chỉ bắt đầu USB **sau khi** toàn bộ mục 6 chạy đạt trên máy thật của tiệm.
Thứ tự đã chốt: **SPIn Cloud → USB (model có SDK chính thức) → Bluetooth (model có SDK chính thức)**.
