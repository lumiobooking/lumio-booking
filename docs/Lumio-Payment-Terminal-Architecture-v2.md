# Lumio Payment Terminal — Kiến trúc v2 (Cloud · USB · Bluetooth)

> Điều chỉnh kiến trúc kết nối payment terminal. Hỗ trợ **3 nhóm kết nối** nhưng
> **KHÔNG xây full Mobile POS**. Bluetooth dùng một **Companion tối giản** (chỉ cầu
> nối thanh toán). Tài liệu này **cập nhật architecture + implementation plan**;
> chưa build Bridge/Companion — chờ chốt provider cho từng Step.

---

## ✅ ĐÃ BUILD (session này) — Relay foundation + Companion reframe

- **Model:** bảng `payment_agents` + `connectionType`/`agentId` trên device/intent (migrations additive).
- **Relay backend:** `AgentService` (one-time pairing code → agent token hash; **poll** trả command + tạo Stripe PI/clientSecret; **result** cập nhật intent; register reader qua agent) + `AgentAdminController` (tạo/list/gỡ) + `AgentRuntimeController` (pair/poll/result/connection-token/readers — auth bằng **agent token**). `PaymentOrchestrator.charge` **định tuyến**: CLOUD gọi thẳng provider; **USB/BT → QUEUED cho agent**.
- **Settings UI:** mục **"Devices & Agents"** (tạo mã ghép, list, gỡ) + Country + Connection Type + Coming soon.
- **Companion (mobile):** reframe `mobile/` thành **cầu nối** — Pair (nhập mã) → poll → Stripe Terminal SDK (Bluetooth) collect/confirm → trả result. **Đã bỏ** nhập tiền/POS.
- **Lumio Payment Bridge (Windows):** `bridge/` — Node **zero-dependency**: pair bằng mã 1 lần, auto-start cùng Windows (Task Scheduler/NSSM), discover + đăng ký terminal, poll lệnh, charge qua **driver**, trả result, báo online/offline, **auto-reconnect** backoff, token lưu quyền `0600`, **không log secret/card**. ✅ **Đã test end-to-end** (pair → nhận lệnh → charge → SUCCEEDED) với driver `simulator`.
- **Transport agent:** dùng **HTTPS long-poll + agent token** (thay vì WSS) — đơn giản, xuyên firewall tiệm, không cần hạ tầng WebSocket. WSS là tối ưu về sau nếu cần độ trễ thấp hơn.

**Còn lại để chạy thật:**
- **USB (Step 2):** Bridge **đã xong + test E2E**. Chỉ còn **1 driver provider thật** (Adyen Local / PAX) — là **1 file drop-in** vào `bridge/src/drivers/`.
- **Bluetooth (Step 3):** build native Companion (dev build + permissions Bluetooth) — code nền đã có.
- Deploy: `deploy.bat` (kèm migrations `payment_agents` + `connectionType`).

---

## 0. Thay đổi chính so với v1

1. Tách rõ **3 connection type**: **Cloud API** / **USB** / **Bluetooth**.
2. USB & Bluetooth cần một **LỚP RELAY** (backend ↔ agent) — vì backend **không** nói
   chuyện trực tiếp với terminal USB/BT được; phải qua một agent chạy cạnh terminal.
3. **USB → Lumio Payment Bridge** (Windows). **Bluetooth → Lumio Payment Companion**
   (mobile tối giản). Cả hai **chỉ là cầu nối thanh toán**: KHÔNG order/booking/
   customer/staff.
4. **Settings UI mới**: Provider → Country → Connection Type → Connect/nhập credentials
   → Pair Bridge/Companion → Select Terminal → Test → Activate. Chỉ hiện connection type
   mà **provider + model + OS thực sự hỗ trợ**; phần chưa làm = **Coming soon**.
5. Phân kỳ: **Step 1 Cloud** (gần xong) → **Step 2 Bridge + 1 USB model thật** →
   **Step 3 Companion + 1 BT model thật**.

---

## 1. Hiện trạng codebase (đã build trong các phiên trước) — map vào v2

| Thành phần | Trạng thái | Thuộc | Cần chỉnh cho v2 |
|---|---|---|---|
| PaymentOrchestrator | ✅ có | Step 1 | Thêm nhánh **relay** cho USB/BT (hiện chỉ server-driven Cloud) |
| PaymentConnector interface | ✅ có | Step 1 | Thêm khái niệm capability theo **connectionType** |
| Capability matrix | ✅ có (theo provider) | Step 1 | Thêm chiều **connectionType × OS** |
| Payment Settings UI (`/salon/payment-terminals`) | ✅ có | Step 1 | ✅ **Đã thêm** Country + Connection Type + Coming soon |
| Cloud providers: **Stripe** (WiFi server-driven), **SumUp**, **Square** | ✅ có | Step 1 | Gắn nhãn nhóm **Cloud API** |
| Nối POS quầy (Cloud path) | ✅ có | Step 1 | Giữ; thêm định tuyến theo connectionType |
| CredentialStore (AES-256-GCM) · webhook · tests | ✅ có | Step 1 | Giữ; thêm agent-auth vào phần bảo mật |
| `PaymentDevice` / `PaymentIntentRecord` | ✅ có | — | ✅ **Đã thêm** `connectionType` + `agentId` (migration additive) |
| **PaymentAgent** + Relay | ✅ **XONG** | Step 2/3 | AgentService pair/poll/result + orchestrator routing CLOUD/USB/BT; Bridge/Companion app tiêu thụ API |
| **Lumio Payment Bridge** (Windows) | ❌ chưa | Step 2 | Xây mới |
| `mobile/` Companion | ✅ **Đã reframe** | Step 3 | Pair→poll→Stripe SDK→result; cần build native + test |

**Kết luận:** phần **Step 1 (Cloud)** gần như đã xong; chỉ còn bổ sung **Country +
Connection Type + Coming soon** ở Settings và **connectionType** trong model để UI/logic
phản ánh đúng kiến trúc v2. Bridge/Companion là Step 2/3.

---

## 2. Kiến trúc 3 connection type

```
CLOUD (WiFi/Internet terminal) — ĐÃ CÓ
  POS Web → Lumio Backend → Provider API → WiFi Terminal
            (backend gọi thẳng provider; đẩy PaymentIntent xuống reader)

USB — Step 2
  POS Web → Lumio Backend → [relay WSS] → Lumio Payment Bridge (Windows)
                                            → Provider SDK → USB Terminal

BLUETOOTH — Step 3
  POS Web → Lumio Backend → [relay WSS] → Lumio Payment Companion (iOS/Android)
                                            → Provider Mobile SDK → BT Reader
```

**Nguyên tắc:** POS Web **luôn chỉ nói với Backend**. Backend quyết định:
- `CLOUD` → gọi thẳng Provider API (đã có).
- `USB`/`BLUETOOTH` → **đẩy lệnh qua agent** (Bridge/Companion) rồi nhận kết quả về.

Nhờ vậy màn POS **không đổi** dù terminal loại nào; chỉ khác đường đi phía sau.

---

## 3. Lớp Relay (mới) — trái tim của USB & Bluetooth

**PaymentAgent** = một bản **Bridge** (Windows) hoặc **Companion** (mobile) đã **pair**
với một **tenant + location**. Agent kết nối **outbound** tới backend qua **WSS**
(WebSocket có TLS), xác thực bằng **agent token** (đổi từ one-time pairing code).

Backend có **Agent Gateway**: giữ danh sách agent đang online, đẩy payment command,
nhận result, theo dõi heartbeat online/offline.

**Flow thanh toán USB/BT:**
1. POS Web → `POST /payments-hub/charge { deviceId }` (device thuộc loại USB/BT).
2. Orchestrator tạo intent `status=QUEUED`, gán `agentId` của device.
3. Gateway đẩy command `{ intentId, amountCents, currency, readerId }` tới agent qua WSS.
   Nếu agent **offline** → trả lỗi "device offline" ngay (không treo).
4. Agent chạy **Provider SDK** → terminal → khách quẹt/chạm.
5. Agent trả result `{ intentId, status, providerRef }` (qua WSS hoặc
   `POST /payments-hub/agent/result`, có ký & verify).
6. Orchestrator cập nhật intent → POS **poll** `getIntent` → đóng bill (như Cloud).

**Đảm bảo:** idempotency giữ nguyên (`clientRef`); command có id, agent xử lý **1 lần**;
mất mạng thì reconcile theo trạng thái intent.

---

## 4. Thay đổi Database (thuần thêm mới — additive)

- `PaymentDevice`: thêm **`connectionType`** (`CLOUD|USB|BLUETOOTH`) + **`agentId?`**.
- `PaymentIntentRecord`: thêm **`connectionType?`** + **`agentId?`**; status thêm **`QUEUED`**.
- Bảng mới **`payment_agents`**: `id, tenantId, locationId?, kind (BRIDGE|COMPANION),
  label, platform, pairingCode?, tokenHash?, status (ONLINE|OFFLINE|UNPAIRED),
  lastSeenAt, createdAt`.
- (Tuỳ chọn) `payment_agent_commands` nếu muốn hàng đợi bền; hoặc tái dùng
  `payment_intents` (`status=QUEUED` + `agentId`).

Tất cả **forward-only, không đụng dữ liệu cũ** → rollback an toàn.

---

## 5. Lumio Payment Bridge (Windows) — thiết kế

Local service/app cho Windows, chức năng:
- **Pair** với 1 tenant/location bằng **one-time pairing code** (hiện ở Settings) →
  đổi lấy **agent token** lưu an toàn (Windows **DPAPI**).
- **Tự khởi động cùng Windows** (Windows Service / Task Scheduler / Run key).
- **Phát hiện terminal USB/LAN** bằng **SDK chính thức của provider**.
- **Nhận payment command** qua kết nối bảo mật (WSS outbound tới backend).
- **Gửi số tiền** tới terminal; **trả kết quả** về backend.
- Báo **online/offline**; **auto-reconnect** (exponential backoff).
- **KHÔNG** lưu card number/CVV/PIN; **KHÔNG** ghi API secret/card vào log.

**Khuyến nghị kỹ thuật:** .NET Worker Service (native Windows, dễ chạy service +
DPAPI) hoặc Node đóng gói (pkg/NSSM). Có UI nhỏ (system tray) để hiện trạng thái + code pair.

⚠️ **Ràng buộc thực tế cần chốt:** provider phải có **SDK Windows/desktop cho USB/LAN**.
**Stripe / SumUp / Square KHÔNG có** SDK Windows (họ là Cloud + Mobile). USB-trên-Windows
thực tế là: **Adyen (Local Terminal API qua LAN)**, hoặc processor chuyên dụng
**PAX / Verifone / Datacap (IPP)**. → **Step 2 phải chọn provider/model có SDK Windows thật**
(đề xuất **Adyen Local** hoặc **PAX**). Đây là quyết định cần anh chốt trước khi làm Bridge.

---

## 6. Lumio Payment Companion (mobile tối giản) — thiết kế

**KHÔNG phải Mobile POS.** Không order/booking/customer/staff. Chỉ là cầu nối:
- **Đăng nhập hoặc quét QR pairing** → gán app cho **tenant + location**.
- **Tìm / pair / unpair** Bluetooth reader được hỗ trợ.
- Hiện **connection status + battery**.
- **Nhận payment request từ backend** (KHÔNG nhập tiền trong app).
- Dùng **Provider Mobile SDK** xử lý payment → **trả status** về backend.
- **Auto-reconnect**. **Chưa cần Tap to Pay** giai đoạn đầu.

**Reframe scaffold `mobile/` đang có:** bỏ màn **nhập tiền** (PayScreen kiểu POS) →
thay bằng **listener**: kết nối WSS, chờ command từ backend, chạy SDK, trả kết quả.
Giữ lại Login + pairing. (README đã cập nhật định hướng này.)

---

## 7. Payment Settings UI (flow mới)

```
Provider → Country → Connection Type (Cloud / USB / Bluetooth)
        → Connect Account HOẶC nhập credentials
        → (USB/BT) Pair Bridge/Companion bằng one-time code
        → Select Terminal → Test → Activate
```
- **Chỉ hiện** connection type mà provider + model + OS **thực sự hỗ trợ**.
- Loại chưa làm xong → **"Coming soon"** (disabled).
- Thêm mục **"Devices & Agents"**: liệt kê Bridge/Companion đã pair + trạng thái online + nút unpair.

---

## 8. Capability matrix (provider × connection type × OS)

| Provider | Cloud (WiFi) | USB (Windows) | Bluetooth (mobile) | Ghi chú |
|---|---|---|---|---|
| **Stripe** | ✅ (đã có) | ❌ không có Windows SDK | ✅ qua mobile SDK (Step 3) | Cloud dùng ngay |
| **SumUp** | ✅ | ❌ | ✅ Solo/mobile SDK | |
| **Square** | ✅ | ❌ | ⚠️ mobile SDK | |
| **Adyen** | ✅ | ✅ **Local Terminal API (LAN/USB)** | ⚠️ | **Ứng viên Step 2 (USB)** |
| **PAX / Verifone** | — | ✅ **Windows SDK** | — | Nếu muốn thuần USB |
| **Clover** | ❌ (đã loại v1) | ❌ | ❌ | Bắt buộc publish app → vi phạm quy tắc |

UI chỉ bật ô ✅; ô ❌/⚠️ hiển thị **Coming soon**.

---

## 9. Phân kỳ triển khai (đúng phạm vi)

**Step 1 — Cloud API (✅ HOÀN TẤT).**
Đã có: Orchestrator, Connector interface, Capability matrix, Payment Settings, Cloud
provider (Stripe + SumUp + Square). **Vừa bổ sung:** Country (US/CA) + Connection Type
(**Cloud = Active**, **USB/Bluetooth = Coming soon**) trong Settings UI; **`connectionType`**
+ **`agentId`** trong `payment_devices` / `payment_intents` (migration additive).

**Step 2 — USB (✅ Bridge XONG).**
Relay + **Lumio Payment Bridge** (Windows) đã build và **test end-to-end** với driver
`simulator`. Còn lại: **1 driver provider thật** (Adyen Local / PAX) — drop-in vào
`bridge/src/drivers/`, không phải sửa gì khác.

**Step 3 — Bluetooth.**
**Lumio Payment Companion** (reframe `mobile/`) + **1 BT provider/model thật**
(đề xuất Stripe Terminal RN hoặc SumUp Solo).

> Mọi provider / connection type **chưa hoàn thành** đều hiển thị **Coming soon**.

---

## 10. Bảo mật (bổ sung cho relay)

- **Agent auth:** one-time pairing code → **agent token** (hash lưu DB, **revocable**).
- **Kênh:** WSS/TLS; command mang `intentId` + **nonce + TTL** (chống replay);
  agent chỉ nhận command của **đúng tenant/location** của mình.
- **Không** truyền/không lưu card/CVV/PIN; **không** log secret/card.
- Bridge lưu token bằng **Windows DPAPI**; Companion bằng **secure storage**.
- Giữ nguyên PCI **SAQ A** (card mã hoá tại đầu đọc, không chạm server Lumio).

---

## 11. Bước tiếp

1. ✅ **Step 1 (Cloud) HOÀN TẤT.**
2. ✅ **Relay foundation + Companion (reframe) XONG** — Bluetooth chạy thật khi build native Companion (dev build).
3. **Chốt provider USB** (Adyen Local / PAX) → viết **1 driver drop-in** cho Bridge. Đây là phần còn lại **duy nhất** của USB.

*Mọi thứ khác của Cloud / USB / Bluetooth đã dựng xong.*
