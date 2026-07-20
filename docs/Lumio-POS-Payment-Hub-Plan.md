# Lumio POS Payment Hub — Kế hoạch kỹ thuật (Phase 0: Phân tích, CHƯA code)

> Tài liệu này **chỉ phân tích + đề xuất**. Không có dòng code nào được thay đổi.
> Sau khi anh duyệt, mới triển khai **Phase 1**.
> Thị trường: **US & Canada** (USD + CAD, Interac). Kiến trúc: **multi-tenant SaaS**.

---

---

## ✅ TRẠNG THÁI: Phase 1 + 2 ĐÃ CODE (chờ deploy) — Stripe · SumUp · Square (BYO paste-key)

Triển khai sau **feature-flag mặc định TẮT** → hệ thống đang chạy KHÔNG bị ảnh hưởng cho tới khi anh bật.

Đã làm:
- **DB:** 5 bảng mới `payment_connections / payment_devices / payment_intents / payment_refunds / payment_webhook_events` (migration `20260720120000_payments_hub`, thuần thêm mới, không đụng bảng cũ).
- **Backend module `payments-hub`:** `PaymentConnector` interface + `MockConnector` + `StripeTerminalConnector`; `PaymentOrchestrator` (idempotency, tenant-scope, RBAC refund, feature-flag); `CredentialStore` (AES-256-GCM, mask, revoke); `ProviderRegistry`; controller + webhook controller (per-tenant, ký-xác-thực).
- **Frontend:** trang `/salon/payment-terminals` (chọn provider → dán key → *Kiểm tra kết nối* → ghép reader → *thử giao dịch* → ngắt kết nối) + link nav "Card terminals".
- **Test:** `payments-hub.spec.ts` (idempotency, cross-tenant isolation, RBAC, mã-hoá-at-rest).
- **Phase 2:** thêm `SquareTerminalConnector` (dán **PAT** + Location ID) + `SumUpConnector` (dán **API key**) — cùng interface, chọn ngay trong màn kết nối; REST bằng `fetch` (không thêm dependency); status qua **polling**. **Clover đã loại** (bắt buộc publish app → vi phạm quy tắc).

**Kiểm chứng trong sandbox:** crypto AES-256-GCM đã test runtime (round-trip + phát hiện giả mạo + sai khoá bị từ chối); `tsc` toàn API sạch (chỉ còn lỗi "stale Prisma client" + "thiếu module stripe" — tự hết sau `prisma generate` + `npm ci` lúc deploy); trang frontend transpile sạch. Spec jest chạy trên máy anh/CI.

**Để BẬT (sau khi chạy `deploy.bat`):** đặt 2 biến env trên API service (Render):
- `PAYMENTS_HUB_ENABLED=true`
- `PAYMENT_ENC_KEY=<hex 32 byte>` — tạo bằng `openssl rand -hex 32` (hoặc `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

Chưa đặt 2 biến này → tính năng ngủ yên, mọi thứ chạy y như cũ. **Rollback = xoá `PAYMENTS_HUB_ENABLED`.**

---

## 0. Kết luận nhanh — "Làm được không?"

**Làm được, và codebase hiện tại đã chuẩn bị sẵn hơn 60% nền móng.** Đây không phải xây từ số 0.

Lý do khả thi cao:
- Đã có **PaymentProvider abstraction** (`charge()`/`refund()`) — đúng hướng, chỉ cần mở rộng cho card-present/terminal.
- Đã có **idempotency pattern** (`Order.clientRef`) — chống trùng giao dịch, tái dùng cho terminal.
- Đã có **sổ cái Order + OrderItem + OrderPayment (tenders)** với split-tender, tip, tax, gift card, change.
- Đã có **webhook Stripe ký-xác-thực** trong module `billing` (`constructEvent` + raw body) — pattern chuẩn để nhân bản cho payment webhook.
- Đã có **multi-tenant + RBAC** (SUPER_ADMIN / SALON_ADMIN / STAFF, mọi bảng có `tenantId`).
- **Stripe SDK đã là dependency** (billing SaaS đang dùng) → Stripe Terminal dùng chung SDK.
- Đã có **cấu hình gateway per-tenant** trong Settings (stripe/square/clover/authorizenet/paypal/sumup).

**Nhưng phải nói thật 3 điểm nặng:**
1. **PCI compliance** — bắt buộc đi hướng *terminal/SDK của nhà cung cấp* (P2PE, card không bao giờ chạm server Lumio) để giữ Lumio ở mức **PCI SAQ A** (nhẹ nhất). Spec của anh đã đúng: *không bao giờ* lưu PAN/CVV/PIN/track.
2. **Mô hình BYO — tiệm tự kết nối tài khoản của chính họ** (chốt theo yêu cầu anh): Lumio **chỉ là lớp tích hợp**, **không tạo tài khoản, không KYC, không xác minh gì từ phía Lumio**. Mỗi tiệm dùng **tài khoản Stripe/Square… của chính mình** và tự bấm 'Kết nối' (dán API key hoặc OAuth). Tiền về **thẳng tài khoản của tiệm**; Lumio **không nằm trong luồng tiền, không giữ quỹ, không phải money-transmitter**.
3. **Bridge (Windows) + Mobile POS (Bluetooth/Tap-to-Pay)** là **2 phần mềm riêng biệt** (Windows service + app native) — nên để Phase sau, không nhồi vào Phase 1.

**Khuyến nghị:** Phase 1 chỉ làm **Stripe Terminal, server-driven, BYO** (tiệm dán key tài khoản Stripe của chính họ, KHÔNG qua Connect), chạy end-to-end 1 nhà cung cấp thật hoàn chỉnh; rồi mới nhân rộng Square/Clover/Adyen và Bridge/Mobile.

---

## 1. Hiện trạng codebase — cái ĐÃ CÓ (tái sử dụng)

| Thành phần | File | Tái dùng cho Payment Hub |
|---|---|---|
| `PaymentProvider` interface (`charge`/`refund`, `ChargeInput{amountCents,currency,reference,description}`, `ChargeResult{success,providerReference,error}`) | `apps/api/src/payments/providers/payment-provider.interface.ts` | **Nền của Orchestrator.** Mở rộng thêm capability + card-present (PaymentIntent/collect on reader). |
| `createPaymentProvider()` factory theo env `PAYMENT_PROVIDER` (chỉ "mock", có sẵn chỗ cắm "stripe") | `payments/providers/payment-provider.factory.ts` | Nâng cấp thành **factory per-tenant, per-provider** (không còn global env). |
| `MockPaymentProvider` | `payments/providers/mock-payment.provider.ts` | Giữ làm provider "mock" cho test/sandbox. |
| `Payment` (sổ cái: tenantId, appointmentId?, amountCents, currency, type, status, provider, providerReference, paidAt) | `prisma/schema.prisma` | Sổ cái tổng. Cần thêm cột: `orderId`, `idempotencyKey`, `deviceId`, `refundedCents`, `providerRaw`. |
| `Order` + `OrderItem` + `OrderPayment` (tenders CASH/CARD/TRANSFER, tip/tax/discount/gift, `clientRef` idempotency, `paidCents/changeCents`) | `prisma/schema.prisma`, `pos/pos.service.ts` | **Ticket POS đã hoàn chỉnh.** Việc còn lại: biến tender "CARD" từ *con số ghi tay* → *charge terminal thật*. |
| Split-tender + collapse-by-method + gift card | `pos/pos.service.ts` (dòng ~194–299) | Giữ nguyên logic; chỉ chèn bước "chờ terminal xác nhận" trước khi đóng ticket. |
| Cấu hình gateway per-tenant (`GATEWAY_IDS`, `GatewayConfig{enabled,apiKey,secret}`, `PaymentGateways`) lưu trong `Setting(tenantId,key,value JSON)` | `settings/settings.constants.ts`, `settings/settings.service.ts` | Nền cho **credential store per-tenant**. ⚠️ Hiện lưu **plaintext** trong JSON — phải thêm mã hoá at-rest (mục 11). |
| Mask secret khi đọc (`sanitizeGateways`), blank-giữ-nguyên khi lưu | `settings/settings.service.ts` | Tái dùng để không lộ secret ra frontend. |
| **Webhook Stripe ký-xác-thực** (`handleStripeWebhook(rawBody,sig)` → `stripe.constructEvent`, `@SkipRateLimit`) | `billing/billing.controller.ts`, `billing/billing.service.ts` | **Pattern chuẩn** để tạo webhook cho payment/terminal. Stripe SDK đã có sẵn. |
| `rawBody` bật sẵn + JSON limit 6MB | `apps/api/src/main.ts` | Webhook cần raw body — đã sẵn sàng. |
| Background job tick (10 phút, gate bằng env) | `bookings/reminder.service.ts` | Pattern cho job **reconcile** giao dịch treo / poll trạng thái terminal. |
| RBAC + tenant scoping (guard theo `tenantId`, roles) | toàn bộ `apps/api/src` | Refund cần quyền; enforcement đã có nền. |
| UI POS + UI billing gateway | `apps/web/src/app/salon/pos/page.tsx`, `salon/billing/page.tsx`, `super-admin/billing/page.tsx` | Chèn bước chọn thiết bị + trạng thái "Chạm/Quẹt thẻ trên máy". |

**Phân biệt tối quan trọng (đừng lẫn):**
- **Stripe của Lumio (platform)** = thu tiền *thuê bao SaaS* từ các tiệm — đang nằm ở module `billing`.
- **Stripe/Square… của từng tiệm (merchant)** = tiệm thu tiền *khách làm nail* — chính là Payment Hub này.
- Hai luồng tiền **tách biệt hoàn toàn**, khác tài khoản, khác key, khác webhook endpoint. Không được dùng chung.

---

## 2. Khoảng trống cần xây (gap)

1. **Khái niệm card-present / Terminal**: interface hiện tại là card-not-present (online). Card-present cần vòng đời **PaymentIntent → collectPaymentMethod (trên reader) → process → capture**, khái niệm **Reader/Device**, **ConnectionToken**.
2. **Capability model**: mỗi provider hỗ trợ khác nhau (terminal / online / tap-to-pay / Interac / partial refund). UI phải render theo capability.
3. **Provider theo tenant**: factory hiện global theo env. Cần khởi tạo provider **theo tenant + theo credential của tiệm**.
4. **Mã hoá credential at-rest**: secret gateway đang plaintext trong `Setting.value`.
5. **Refund có liên kết + partial + audit**: hiện `refund(providerReference)` chỉ refund toàn phần, không lưu vết, không RBAC riêng.
6. **Webhook payment/terminal per-tenant** (khác webhook billing): `payment_intent.succeeded`, `reader.*`, Square `terminal.checkout.updated`…
7. **Đăng ký/ghép thiết bị (reader)** theo tenant + location.
8. **Màn 'Kết nối thanh toán'** cho tiệm **tự dán API key** của chính họ (không OAuth, vì OAuth cần app Lumio) + test + revoke.
9. **Lumio Payment Bridge** (Windows, USB/LAN reader) — phần mềm riêng.
10. **Lumio Mobile POS** (Bluetooth / Tap to Pay) — app native riêng.

---

## 3. Kiến trúc đề xuất

```
                         apps/web (Next.js)            wordpress-plugin
                          POS UI / Billing UI          (chỉ booking, KHÔNG chạm card)
                                  |
                                  v  (JWT, tenant-scoped)
        ┌─────────────────────────────────────────────────────────────┐
        │                 apps/api (NestJS)  —  module MỚI: payments-hub │
        │                                                               │
        │   PaymentOrchestrator  ── chọn provider theo tenant+capability│
        │        │                                                      │
        │        ├── ProviderRegistry (capability matrix)               │
        │        ├── CredentialStore (mã hoá at-rest, revocable)        │
        │        ├── IdempotencyService (tái dùng Order.clientRef)      │
        │        ├── PaymentLedger  (Payment + Refund + audit)          │
        │        └── WebhookRouter  (ký-xác-thực từng provider)         │
        │                                                               │
        │   Provider Connectors (implements PaymentConnector):          │
        │     StripeTerminalConnector │ SquareTerminalConnector │       │
        │     CloverConnector │ AdyenConnector │ MockConnector          │
        └───────┬──────────────────────────────┬───────────────────────┘
                │ server-driven                 │ webhooks (ký-xác-thực)
                v                               ^
   ┌────────────────────────┐          ┌──────────────────────┐
   │  Reader/Terminal của    │          │  PSP cloud            │
   │  tiệm (P2PE, giữ card)  │◄────────►│  (Stripe/Square/…)    │
   └────────────────────────┘          └──────────────────────┘
        ▲                    ▲
        │ USB/LAN            │ Bluetooth / Tap-to-Pay
 ┌───────────────┐   ┌────────────────────┐
 │ Lumio Payment │   │ Lumio Mobile POS   │   ← Phase 4–5 (phần mềm riêng)
 │ Bridge (Win)  │   │ (iOS/Android SDK)  │
 └───────────────┘   └────────────────────┘
```

**Nguyên tắc kiến trúc:**
- **Server-driven** là mặc định: backend tạo PaymentIntent/checkout rồi "đẩy" xuống reader đã ghép của tiệm. Card **không bao giờ** qua server Lumio → giữ PCI SAQ A.
- **Business logic chỉ phụ thuộc `PaymentConnector` interface** (mở rộng từ `PaymentProvider` đang có). Thêm provider = thêm 1 connector, không sửa POS/Order.
- **Capability-based**: Orchestrator hỏi connector "mày làm được gì" → UI bật/tắt nút theo đó.
- **Tenant isolation tuyệt đối**: credential, reader, giao dịch, webhook đều gắn `tenantId`; mọi truy vấn scope theo tenant đã xác thực.

### PaymentConnector interface (đề xuất — mở rộng cái đã có)
```ts
interface PaymentConnector {
  readonly id: 'stripe' | 'square' | 'clover' | 'adyen' | 'mock';
  capabilities(): ConnectorCapabilities;              // terminal? online? tapToPay? interac? partialRefund?
  // Onboarding
  connect(ctx: TenantCtx, creds: unknown): Promise<ConnectResult>;
  // Thiết bị
  listReaders(ctx: TenantCtx): Promise<Reader[]>;
  registerReader(ctx: TenantCtx, code: string, locationId?: string): Promise<Reader>;
  connectionToken?(ctx: TenantCtx): Promise<string>;  // cho SDK client (mobile)
  // Thanh toán card-present (server-driven)
  createIntent(ctx: TenantCtx, req: ChargeInput & { readerId?: string }): Promise<Intent>;
  collectOnReader(ctx: TenantCtx, intentId: string, readerId: string): Promise<Intent>;
  processIntent(ctx: TenantCtx, intentId: string): Promise<Intent>;
  getIntent(ctx: TenantCtx, intentId: string): Promise<Intent>;
  cancelIntent(ctx: TenantCtx, intentId: string): Promise<void>;
  // Hoàn tiền
  refund(ctx: TenantCtx, paymentRef: string, amountCents?: number): Promise<RefundResult>;
  // Webhook
  verifyWebhook(rawBody: Buffer, headers: Record<string,string>, secret: string): WebhookEvent;
}
```
> Giữ nguyên `charge()/refund()` cũ cho luồng **online deposit** (đặt cọc booking) để không phá code hiện có; interface mới là **superset**.

---

## 4. Provider Capability Matrix (đã kiểm chứng web 07/2026)

| Năng lực | **Stripe Terminal** | **Square Terminal API** | **Clover** | **Adyen** |
|---|---|---|---|---|
| US + Canada | ✅ | ✅ | ✅ | ✅ |
| Server-driven (đẩy xuống reader) | ✅ (PaymentIntent + reader) | ✅ (Terminal Checkout tới máy đã ghép) | ✅ (REST Pay Display, semi-integrated SDK) | ✅ (Terminal API cloud/local) |
| Tap to Pay điện thoại | ✅ iPhone (US+CA) & Android (US,CA,UK,AU,NZ,SG) | ⚠️ qua Mobile Payments SDK | ❌ (thiên về máy Clover) | ⚠️ hạn chế |
| Interac (Canada) | ✅ (reader Canada; Flash ≤ 250 CAD, PIN khi cao) | ✅ (⚠️ refund **chỉ** cho Interac debit ở CA) | ✅ (trên máy Clover CA) | ✅ |
| Tiệm tự nhập API key (Lumio KHÔNG đăng ký gì) | ✅ **Dán restricted key** (scope tối thiểu) | ⚠️ **Dán PAT** của tiệm (không OAuth); token full-quyền | ❌ Bắt buộc app + RAID + cài App Market → **vi phạm quy tắc** | ✅ Dán **API key** (role Cloud) nhưng onboarding nặng |
| Partial refund | ✅ | ✅ (trừ ràng buộc Interac) | ✅ | ✅ |
| Webhook ký-xác-thực | ✅ (`constructEvent`) | ✅ (Terminal webhooks) | ✅ | ✅ (HMAC) |
| Độ mở API / dễ tích hợp | ★★★★★ | ★★★★ | ★★★ (đóng hơn) | ★★★ (nặng) |
| **Khuyến nghị Phase** | **Phase 1** | Phase 2 | Phase 3 | Phase 3–4 |

**Vì sao Stripe Terminal đi trước:** API mở nhất, **chạy bằng key trực tiếp của từng tiệm (không cần Connect)**, Interac + Tap-to-Pay US/CA đầy đủ, **và Stripe SDK đã nằm trong dự án**.

---

## 5. Mô hình BYO — tiệm tự kết nối (chốt theo yêu cầu anh)

**Nguyên tắc:** Lumio **chỉ tích hợp** — không tạo, không sở hữu, không xác minh tài khoản thanh toán. Mỗi tiệm mang **tài khoản provider của chính mình** và tự kết nối:
- **Stripe:** tiệm dán **secret key** tài khoản Stripe của họ → Lumio lưu mã hoá, gọi API Terminal bằng key đó. **Lumio không cần đăng ký gì** (không Connect, không KYC).
- **Square/Adyen/SumUp:** tiệm cũng **tự tạo API key/token trên tài khoản của họ rồi dán vào** (KHÔNG dùng OAuth — vì OAuth bắt buộc Lumio phải có app). Chi tiết từng provider ở mục 5.1–5.2.
- **Clover:** ⚠️ card-present bắt buộc Lumio publish app + cài từ App Market → **vi phạm quy tắc 'Lumio không đăng ký gì'** → **đề xuất loại** (xem 5.1).

**Luồng tiền:** về **thẳng tài khoản của tiệm**. Lumio **không nằm trong luồng tiền → không giữ quỹ, không phải money-transmitter, không phát sinh 1099-K cho Lumio.**

**Doanh thu Lumio:** chỉ **thuê bao SaaS** (không thu phí trên từng giao dịch, vì không ở trong luồng tiền) — hệ quả trực tiếp của mô hình BYO.

**PCI scope:** vẫn dùng terminal P2PE + SDK provider → thẻ mã hoá tại đầu đọc, không chạm server Lumio → Lumio giữ mức **SAQ A** (nhẹ nhất). Bắt buộc.

**Ranh giới hỗ trợ:** nếu tài khoản của tiệm bị Stripe/Square giữ payout hay hỏi KYC, đó là việc giữa **tiệm ↔ provider**; Lumio chỉ tích hợp, không can thiệp.

---

### 5.1 Bảng phương án tích hợp — "khách tự nhập API key" (nghiên cứu 07/2026)

Tiêu chí: tiệm **tự tạo credential trên tài khoản của chính họ** rồi **dán vào Lumio**; **Lumio không đăng ký/không publish app nào**; card-present chạy chỉ bằng key đã dán.

| Provider | Card-present bằng key dán tay? | Lumio phải đăng ký gì? | Tiệm lấy key thế nào | Bảo mật key | Độ khó tiệm | Phase |
|---|---|---|---|---|---|---|
| **Stripe Terminal** | ✅ Có | **❌ Không gì cả** | Tạo **Restricted key `rk_live_…`** trong Dashboard (chỉ quyền Terminal + PaymentIntents) | ★★★ scope tối thiểu, revoke tức thì | Thấp | **1** |
| **SumUp** | ✅ Có (Cloud API + Solo reader) | ❌ Không (kiểm 'Affiliate Key' lúc build) | Tạo **API key** trong Dashboard SumUp | ★★ full-quyền | Thấp | 2 |
| **Square Terminal** | ⚠️ Được — qua **Personal Access Token** của tiệm (KHÔNG OAuth vì OAuth cần app Lumio) | ❌ Không | Tự tạo 1 app trong **Square Developer** của họ → **PAT** + Location ID | ★ token full-quyền, không scope được | Trung–cao | 2–3 |
| **Adyen** | ✅ Có (Terminal API cloud) | ❌ Không | Tạo **API key (role Cloud Device)** trong Customer Area | ★★ | Cao (onboarding enterprise) | 3+ |
| **Clover** | ❌ **Không** | ⚠️ **Bắt buộc app semi-integration + RAID + cài từ App Market** → **vi phạm quy tắc** | — | — | — | **Loại** cho card-present (chỉ làm được hosted-checkout online, không đụng máy Clover) |

**Kết luận:**
- **Stripe = sạch nhất** cho mô hình của anh: 1 restricted key, Lumio không đăng ký gì, bảo mật tốt nhất (key giới hạn quyền + tiệm tự revoke) → **Phase 1**.
- **SumUp** rẻ, hợp tiệm nhỏ, dán key thẳng → **Phase 2**.
- **Square** làm được nhưng dùng PAT (tiệm setup hơi cực, token full-quyền) → **Phase 2–3**.
- **Adyen** cho khách lớn/nhiều chi nhánh → **Phase 3+**.
- **Clover không hợp** quy tắc "Lumio không đăng ký gì" cho máy quẹt → **đề xuất bỏ** (nếu cần, chỉ làm thanh toán online hosted-checkout sau).

### 5.2 Mỗi provider — tiệm lấy key ở đâu (hiện ngay trong màn kết nối)

- **Stripe:** Dashboard → Developers → API keys → *Create restricted key* → bật quyền **Terminal**, **PaymentIntents**, **Charges/Refunds** → copy `rk_live_…` → dán vào Lumio. Mua reader (WisePad/BBPOS/S700); Lumio đăng ký reader bằng chính key đó.
- **SumUp:** Dashboard → tạo **API key** → dán vào Lumio → ghép **Solo reader** (đã pair với tài khoản SumUp của tiệm).
- **Square:** developer.squareup.com (tài khoản **của tiệm**) → tạo application → **Production Access Token** + **Location ID** → dán vào Lumio → tạo *device code* để ghép Square Terminal.
- **Adyen:** Customer Area → Developers → API credentials → *Generate API Key* (role **Cloud Device API**) → dán vào Lumio + **Merchant Account** + **POI/Terminal ID**.

### 5.3 Màn "Kết nối thanh toán" (thiết kế UX — khách tự nhập)

1. **Chọn nhà cung cấp** (thẻ radio): Stripe / SumUp / Square / Adyen — nhãn "Khuyên dùng: Stripe".
2. **Form nhập credential** đúng field từng provider + hướng dẫn "Lấy key ở đâu" (mục 5.2) ngay cạnh.
3. **Nút "Kiểm tra kết nối"** → backend gọi 1 API **chỉ-đọc** (VD Stripe: liệt kê locations/readers) để xác thực key **mà không dịch chuyển tiền** → hiện ✓ + năng lực phát hiện được (reader nào, USD/CAD, Interac?).
4. **Ghép reader**: Stripe theo *pairing code*; Square theo *device code*; hiện trạng thái online.
5. **Lưu mã hoá** (AES-256-GCM), **che khi hiển thị** (chỉ 4 ký tự cuối), nút **"Ngắt kết nối / Thu hồi"**; nhắc tiệm có thể **tự revoke key phía provider** bất cứ lúc nào.
6. **POS theo năng lực**: chỉ bật "Quẹt thẻ", "Interac", "Tap to Pay"… khi provider + vùng của tiệm hỗ trợ.

**Bảo mật riêng cho mô hình dán key:**
- Ưu tiên **key giới hạn quyền** khi provider hỗ trợ (Stripe restricted key). Provider chỉ có token full-quyền (Square PAT, SumUp) → **cảnh báo tiệm + mã hoá at-rest + revoke dễ**.
- **Validate format** key trước khi lưu; **không bao giờ log** key; test-call chỉ đọc, không charge.

## 6. Các luồng (Flows)

### 6.1 Thanh toán card-present (server-driven)
```
POS (web) → API: POST /payments-hub/intents  {orderId, amountCents, currency, readerId, clientRef}
API: IdempotencyService kiểm tra clientRef → nếu trùng, trả kết quả cũ (không charge lại)
API → Connector.createIntent() → Connector.collectOnReader(readerId)
Reader hiện "Chạm/Quẹt/Chèn thẻ" → khách thao tác → Connector.processIntent()
PSP → webhook payment_intent.succeeded → WebhookRouter (verify chữ ký) →
   PaymentLedger ghi Payment(status=PAID, providerReference) + đóng OrderPayment(CARD) →
   Order.status=PAID (đúng logic pos.service hiện tại)
POS poll GET /intents/:id hoặc nhận realtime → in receipt
```
- **Idempotency**: `clientRef` (đã có ở Order) + `idempotencyKey` gửi lên PSP → mất mạng/không double-charge.
- **Nguồn sự thật = webhook** (không tin mỗi response client).

### 6.2 Refund
```
POS → API: POST /payments-hub/refunds {paymentId, amountCents?}  (RBAC: SALON_ADMIN, hoặc STAFF nếu được cấp)
API: kiểm tra payment thuộc đúng tenant → Connector.refund(ref, amount) →
   ghi Refund row + cập nhật Payment.refundedCents, Order.status=REFUNDED (nếu full) →
   audit_log(action='payment.refund', tenantId, userId, amount)
```
- Interac (Square CA): chỉ refund debit Interac → UI phải chặn theo capability.

### 6.3 Webhook
```
PSP → POST /payments-hub/webhook/:provider  (raw body, @SkipRateLimit)
verify chữ ký bằng secret riêng của provider (per-tenant nếu cần) →
ghi WebhookEvent(dedupe theo event.id) → xử lý idempotent → 200 OK nhanh
```
Tái dùng đúng pattern `billing` đang chạy.

### 6.4 Offline / mất mạng
- Reader vẫn xử lý; API dùng job **reconcile** (pattern `reminder.service`) để poll intent treo và đồng bộ khi mạng lại. `clientRef` đảm bảo không nhân đôi.

---

## 7. Thiết kế Database + Migrations

> Quy ước migration hiện tại: `YYYYMMDDHHMMSS_ten` (đã có 70 migration). Tất cả bảng mới **đều có `tenantId` + index**.

**Migration 1 — hạ tầng provider & thiết bị**
- `payment_connections` — kết nối merchant per-tenant: `id, tenantId, provider, status(PENDING/ACTIVE/REVOKED), externalAccountId, credentialEnc(bytes), createdAt`. (Thay việc để secret trong `Setting` JSON.)
- `payment_devices` (readers): `id, tenantId, provider, externalReaderId, label, locationId?, status, lastSeenAt`.

**Migration 2 — sổ cái mở rộng**
- Thêm cột vào `payments`: `orderId?`, `idempotencyKey?`, `deviceId?`, `refundedCents Int @default(0)`, `providerRaw Json?`, `capturedAt?`. (Không phá cột cũ.)
- `payment_intents` — vòng đời card-present: `id, tenantId, orderId?, provider, externalIntentId, amountCents, currency, status, deviceId?, clientRef, createdAt, updatedAt`.
- `payment_refunds` — `id, tenantId, paymentId, amountCents, reason?, provider, externalRefundId, status, createdByUserId, createdAt`.

**Migration 3 — webhook & audit**
- `payment_webhook_events` — `id, tenantId?, provider, externalEventId (unique), type, payload Json, processedAt?` (dedupe).
- Tái dùng `audit_logs` sẵn có cho `payment.*` (charge/refund/void/connect/revoke).

> Tất cả là **thêm mới** hoặc **thêm cột nullable** — migration **forward-only, không phá dữ liệu cũ** (an toàn rollback).

---

## 8. File / Module cần tạo & sửa

**Tạo mới (backend) — module `apps/api/src/payments-hub/`:**
- `payments-hub.module.ts`, `payments-hub.controller.ts`, `payment-orchestrator.service.ts`
- `provider-registry.service.ts`, `credential-store.service.ts`, `idempotency.service.ts`, `payment-ledger.service.ts`, `webhook-router.controller.ts`
- `connectors/payment-connector.interface.ts` (superset)
- `connectors/stripe-terminal.connector.ts` (Phase 1)
- `connectors/{square,clover,adyen,mock}.connector.ts` (Phase 2–3)
- `common/crypto.util.ts` (AES-256-GCM mã hoá credential; khoá từ env/KMS)
- `dto/*` + `*.spec.ts`

**Sửa (thêm, không phá):**
- `prisma/schema.prisma` — model/cột mới (mục 7).
- `pos/pos.service.ts` — chèn nhánh "tender CARD = charge terminal thật" trước khi đóng ticket (giữ nguyên cash/gift/split).
- `app.module.ts` — đăng ký `PaymentsHubModule`.
- `settings/*` — chuyển đọc credential sang `CredentialStore` (giữ tương thích ngược).
- `main.ts` — thêm route webhook mới vào rawBody allowlist nếu cần.

**Frontend (`apps/web`):**
- `salon/payments/page.tsx` — kết nối provider, ghép reader, trạng thái KYC.
- `salon/pos/page.tsx` — chọn thiết bị + màn "Đang chờ khách quẹt thẻ" + kết quả + in receipt.
- `salon/billing/page.tsx` — hiển thị giao dịch/refund theo capability.
- `super-admin/*` — bật/tắt provider theo plan/feature-override (đã có cơ chế feature override).

**Phần mềm riêng (Phase 4–5):**
- `bridge/` — Lumio Payment Bridge (Windows service, WebSocket localhost ↔ USB/LAN reader).
- `mobile/` — Lumio Mobile POS (React Native/native, Stripe Terminal SDK Bluetooth/Tap-to-Pay).

---

## 9. Impact analysis (ảnh hưởng hệ thống đang chạy)

- **Booking / trang khách**: **0 ảnh hưởng** (không chạm luồng public booking).
- **POS hiện tại**: cash/gift/transfer **giữ nguyên**; chỉ tender CARD có nhánh mới, **bật sau feature-flag** (mặc định tắt → hành vi cũ không đổi).
- **Billing SaaS**: không đụng (khác module, khác Stripe account).
- **DB**: chỉ thêm bảng + cột nullable → không khoá bảng lớn, không mất dữ liệu.
- **Env mới cần thêm**: `PAYMENTS_HUB_ENABLED`, `PAYMENT_ENC_KEY` (hoặc KMS), webhook secrets. Credential Stripe/Square là **của từng tiệm**, lưu mã hoá trong DB (không phải env global). Thiếu env → module tự tắt an toàn (fail-safe).
- **Rủi ro lớn nhất**: cấu hình sai môi trường/secret; giảm thiểu bằng feature-flag + sandbox trước.

---

### 9.1 Các quy trình tự động hoá hiện có — CÓ, vẫn chạy tự động

Mô hình dán-key chỉ đổi **nguồn credential** (lấy từ tài khoản của tiệm, lưu mã hoá), **không đổi kiến trúc tự động hoá**. Tiệm **kết nối 1 lần duy nhất** (dán key + ghép reader), sau đó **không thao tác gì thêm cho mỗi giao dịch**.

- **Thu tiền card-present vẫn server-driven, tự động:** POS bấm 'Tính tiền' → hệ thống **tự** tạo PaymentIntent bằng key của tiệm → **tự** đẩy xuống reader → khách chạm thẻ → **webhook** (ký-xác-thực) quay về → hệ thống **tự** đóng ticket, ghi Payment, tính tiền thối/tip. Không nhập key theo từng lần.
- **Không phá pipeline sẵn có:** nhắc lịch (reminder tick), **xin review giữa buổi** (processDueReviewRequests), nhắc quay lại (rebooking), trần tần suất + STOP, gán thợ tự động, GA4/GTM conversion — tất cả kích hoạt theo **trạng thái booking/appointment**, độc lập với nhà cung cấp thanh toán → **giữ nguyên 100%**.
- **Kích thêm sau khi trả tiền (tuỳ chọn):** tự bắn *receipt* + *conversion 'purchase'* + kích *review request* ngay khi payment thành công.
- **Chống lỗi vẫn tự động:** idempotency (clientRef) + job reconcile → mất mạng không tạo trùng, không cần sửa tay.
- **Suy giảm mềm:** tiệm chưa kết nối provider → nút thẻ tắt riêng tiệm đó, tiền mặt/tender khác vẫn chạy; không tiệm nào ảnh hưởng tiệm khác (scope theo `tenant_id`).
- **Việc duy nhất cần con người:** khách **chạm thẻ thật** (bản chất card-present) + tiệm **kết nối 1 lần**. Nếu tiệm tự revoke key phía provider, hệ thống **phát hiện** và hiện trạng thái rõ ràng thay vì lỗi ngầm.

> Muốn **tự động 100% không cần chạm thẻ** (đặt cọc, phí no-show, card-on-file) → đó là luồng *card-not-present*, dùng chung key nhưng là capability riêng, thêm sau.

## 10. Rollback plan

1. **Feature flag** `PAYMENTS_HUB_ENABLED=false` → tắt toàn bộ nhánh card mới, POS về đúng hành vi cũ ngay lập tức (không cần deploy lại code).
2. **Migration forward-only**: bảng/cột mới không phá cột cũ; nếu cần lùi, chỉ ngừng ghi — không drop dữ liệu.
3. **Per-tenant rollout**: bật cho 1 tiệm demo trước (dùng `featureOverrides` đã có), lỗi thì tắt riêng tiệm đó.
4. **Connector cô lập**: lỗi 1 provider không ảnh hưởng provider khác (registry tách biệt).
5. Deploy theo `deploy.bat` → Render → `prisma migrate deploy` như quy trình hiện tại; giữ được ảnh DB trước khi migrate.

---

## 11. Security checklist (PCI-sensitive)

- [ ] **Không bao giờ** lưu/log PAN, CVV, PIN, track data. Chỉ dùng terminal/SDK P2PE của provider → giữ **PCI SAQ A**.
- [ ] **Mã hoá at-rest** credential (AES-256-GCM), khoá từ env/secret-manager/KMS — **thay** việc để plaintext trong `Setting.value` hiện nay.
- [ ] Credential **revocable** + **rotate** được; khi revoke thì connector ngừng hoạt động ngay.
- [ ] **Webhook**: verify chữ ký từng provider (`constructEvent`/HMAC), dedupe theo `externalEventId`, chỉ nhận qua HTTPS.
- [ ] **Idempotency** mọi lệnh charge/refund (clientRef + idempotency key gửi PSP).
- [ ] **RBAC refund**: mặc định SALON_ADMIN; STAFF chỉ khi được cấp quyền; SUPER_ADMIN không tự ý refund tiền tiệm.
- [ ] **Tenant isolation**: mọi query payment scope theo `tenantId` đã xác thực; có test chống rò chéo tenant.
- [ ] **Rate limit** endpoint payment; webhook `@SkipRateLimit` nhưng chặn theo chữ ký.
- [ ] **Không lộ secret/internal id** ra frontend (tái dùng `sanitize`/mask đã có).
- [ ] **Audit log** mọi hành động tiền: `tenantId, userId, action, amount, timestamp`.
- [ ] Log **không chứa** token/secret/card data (redact).
- [ ] Secrets chỉ trong env/secret-manager, **không hard-code**, **không** để trong WordPress plugin.

---

## 12. Testing plan

- **Unit**: mỗi connector (mock PSP), Orchestrator chọn provider theo capability, IdempotencyService (gọi 2 lần cùng clientRef → 1 charge), CryptoUtil (mã hoá/giải mã).
- **Integration (sandbox)**: Stripe Terminal **simulated reader** → tạo intent → collect → process → webhook → Order PAID; refund toàn phần & một phần; Interac path (CA).
- **Cross-tenant isolation** (bắt buộc theo project rule): tiệm A **không** đọc/refund được payment/reader/intent của tiệm B → phải trả 403/404.
- **Webhook**: chữ ký sai → từ chối; event trùng → xử lý 1 lần (dedupe); replay attack.
- **Failure**: mất mạng giữa chừng → intent treo → reconcile job đồng bợ; huỷ intent; reader offline.
- **E2E**: POS split-tender (part cash + part card) đóng ticket đúng số tiền/tip/thuế.
- **Regression**: POS cash/gift/transfer cũ không đổi khi flag tắt.

---

## 13. Tài khoản / thông tin anh cần chuẩn bị

1. **Phía Lumio (gần như không cần gì):** 1 tài khoản Stripe *test* để dev + simulated reader. Không Connect, không KYC.
2. **Phía mỗi tiệm (tự làm):** tài khoản Stripe riêng + bật **Stripe Terminal** + mua **reader** (WisePad/BBPOS/S700) + dán **secret key** vào màn 'Kết nối thanh toán' của Lumio.
3. Với Canada: xác nhận cần **Interac** ngay Phase 1 không.
4. **Secret manager / KMS** (hoặc chấp nhận env `PAYMENT_ENC_KEY` trên Render giai đoạn đầu).
5. **Không có gì phía Lumio cho các provider khác.** Tiệm tự tạo & dán: SumUp (API key), Square (PAT + Location ID — tiệm tự tạo app trong Square Developer của họ), Adyen (API key role Cloud). **Clover bị loại** cho card-present (xem 5.1).
6. Xác nhận **hosting Bridge/Mobile** về sau (Windows máy tiệm; app store dev accounts nếu làm mobile).

---

## 14. Câu hỏi cần anh chốt trước khi code Phase 1

1. **Provider Phase 1 = Stripe Terminal** (dán restricted key, Lumio không đăng ký gì — sạch nhất). Phase 2: **SumUp + Square (PAT)**; Phase 3+: **Adyen**; **bỏ Clover** cho card-present. Anh đồng ý thứ tự này chứ?
2. **Mô hình BYO** (đã chốt): tiệm tự kết nối tài khoản của mình, Lumio chỉ tích hợp, không giữ quỹ, doanh thu chỉ từ thuê bao SaaS — đúng chứ?
3. **Application fee**: Phase 1 **không thu phí** giao dịch (chỉ thuê bao SaaS) — đúng ý anh?
4. **Phạm vi Phase 1**: chỉ **card-present server-driven trên web POS** (reader USB/Bluetooth qua SDK), **chưa** làm Bridge/Mobile — ok?
5. **Interac**: cần ngay Phase 1 hay để Phase 2?
6. **Refund quyền**: mặc định chỉ SALON_ADMIN — đúng chứ?
7. **Rollout**: bật thử ở **1 tiệm demo** trước qua feature-override — đồng ý?

---

## 15. Phân kỳ (Phased rollout)

| Phase | Nội dung | Kết quả |
|---|---|---|
| **1** | Module `payments-hub` + `PaymentConnector` + **StripeTerminalConnector** (server-driven) + kết nối tài khoản BYO (dán key) + reader pairing + intent/refund/webhook + mã hoá credential + POS card flow (flag) + UI salon/payments | 1 tiệm quẹt thẻ thật end-to-end trên web POS |
| **2** | **SumUpConnector** (API key) + **SquareTerminalConnector** (PAT, không OAuth) + capability UI + reconcile job + partial refund | 3 provider, chọn được |
| **3** | **AdyenConnector** (API key Cloud) cho khách lớn/đa chi nhánh | Đủ provider hợp quy tắc |
| **4** | **Lumio Payment Bridge** (Windows USB/LAN) | Reader không-Bluetooth |
| **5** | **Lumio Mobile POS** (Bluetooth / Tap to Pay) | Thu tiền trên điện thoại |

---

## 16. Đề xuất bắt đầu (khi anh duyệt)

Phase 1, đúng thứ tự, **sau khi anh xác nhận mục 14**:
1. Migration 1–3 (bảng/cột mới, forward-only).
2. `PaymentConnector` interface + `MockConnector` + test.
3. `StripeTerminalConnector` (sandbox, simulated reader).
4. Orchestrator + CredentialStore (mã hoá) + IdempotencyService + PaymentLedger.
5. Webhook router (verify chữ ký, dedupe).
6. Chèn card flow vào `pos.service` sau feature-flag.
7. UI `salon/payments` + màn quẹt thẻ ở POS.
8. Test cross-tenant + e2e sandbox → bật cho 1 tiệm demo.

> **Chưa code gì cho tới khi anh trả lời mục 14.**
