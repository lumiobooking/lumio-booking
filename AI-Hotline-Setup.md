# AI Hotline (Tổng đài AI) — Setup & Go‑Live Guide

Trợ lý AI nghe điện thoại tiệm, trả lời câu hỏi và tự đặt lịch — **khi không ai bắt máy**.
Tiệm **giữ nguyên số của họ**; cuộc gọi được **chuyển hướng** sang một số Lumio phía sau.

---

## 1. Cách hoạt động (flow)

```
Khách gọi SỐ CỦA TIỆM (trên Google/Facebook/card)
        │  không ai bắt máy sau vài hồi chuông
        ▼
Nhà mạng chuyển hướng → SỐ LUMIO (ẩn, gắn tenant_id)
        ▼
Twilio gọi webhook → /api/voice/incoming
        ▼
Bot chào (kèm câu "trợ lý tự động") → nghe khách nói (speech→text)
        ▼
Agent Claude (dùng lại prompt + botFacts + tool đặt lịch của Messenger)
        ▼
Tạo booking trong Lumio → xác nhận bằng giọng nói → nhắn SMS xác nhận cho khách
```

Kỹ thuật: **Twilio `<Gather input="speech">`** (HTTP, không cần WebSocket). LLM = **Claude Haiku** (dùng lại `ANTHROPIC_API_KEY` đã có). Tenant được nhận diện từ **số Lumio được gọi tới** (mỗi số gắn đúng 1 tiệm).

---

## 2. Việc cần làm để LÊN LIVE

### Bước 0 — Deploy code
Chạy **`deploy.bat`**. Render sẽ tự chạy migration `20260705100000_voice_hotline` (tạo bảng `voice_lines`, `voice_calls`) và regenerate Prisma client.

### Bước 1 — Kiểm tra biến môi trường trên Render (service `lumio-api`)
| Biến | Giá trị | Ghi chú |
|---|---|---|
| `ANTHROPIC_API_KEY` | (đã có) | Dùng chung với review + Messenger |
| `PUBLIC_API_URL` | `https://lumio-api-uqm6.onrender.com` | Dùng để tạo URL webhook TwiML. Nếu chưa set, hệ thống tự dùng `RENDER_EXTERNAL_URL` — vẫn chạy được. |

### Bước 2 — Mua số Twilio (tài khoản Lumio) cho mỗi tiệm
1. Twilio Console → **Phone Numbers → Buy a number** → chọn số **local, có Voice**.
2. Mở số vừa mua → **Voice Configuration** → *A call comes in* = **Webhook**, method **HTTP POST**, URL:
   ```
   https://lumio-api-uqm6.onrender.com/api/voice/incoming
   ```
3. Save.

### Bước 3 — Gán số cho tiệm (Super Admin)
Vào **`/super-admin/voice`** → chọn tiệm → nhập số Lumio (E.164, vd `+14085551234`) → **Assign number**.

### Bước 4 — Tiệm bật + chuyển hướng (Salon Admin)
Trong tài khoản tiệm → menu **AI Hotline (📞)**:
1. Thấy **số Lumio** được gán.
2. Bật công tắc **Enable AI hotline**.
3. Làm theo hướng dẫn **chuyển hướng khi không trả lời** (mã `*92 <số Lumio>` cho landline, hoặc cài trong app VoIP).

Xong — khách gọi tiệm, không ai bắt máy → bot trả lời & đặt lịch.

---

## 3. Cách TEST trước khi bật cho khách

**Cách nhanh nhất (không cần forward):** gọi **thẳng số Lumio** vừa mua. Bot sẽ trả lời ngay. Thử kịch bản: *"I'd like to book a gel manicure tomorrow at 2 PM, my name is Anna."* → kiểm tra lịch xuất hiện trong Calendar + SMS xác nhận (nếu tiệm đã kết nối Twilio SMS).

Sau khi ưng → mới cài forwarding trên số thật của tiệm.

---

## 4. Tuân thủ pháp lý (đã build sẵn)

- **Thông báo AI:** bot **luôn** mở đầu bằng câu *"You've reached the automated booking assistant for …"* → thỏa luật CA (AB 2905 / SB 243) & TX 2026 phải báo trước khi trò chuyện.
- **Ghi âm:** **mặc định KHÔNG ghi âm.** Chỉ lưu transcript (chữ) đủ để đặt lịch → tránh vướng luật ghi âm 2 bên (CA, FL, IL, WA…). Nếu sau này muốn ghi âm, phải thêm câu xin phép.
- **Inbound** (nghe gọi đến) **không cần** đăng ký A2P 10DLC như SMS, không cần App Review.

> ⚠️ Mình không phải luật sư. Luật AI theo bang đổi nhanh (nhất là California). Nên nhờ luật sư liếc qua kịch bản bot trước khi bán rộng.

---

## 5. Chi phí (tham khảo)

Twilio Voice + speech: ~**$0.02–0.10/phút**; LLM (Haiku): vài cent/cuộc. Trọn gói ~**$0.10–0.20/phút** → cuộc đặt lịch 3 phút ≈ **$0.30–0.60**. Nên bán thành **gói add-on** (vd chỉ gói Pro+ mới có AI Hotline).

---

## 6. Giới hạn hiện tại & Nâng cấp Phase 2

**MVP này (đủ dùng để bán):**
- Nghe gọi đến, trả lời câu hỏi (giờ mở cửa, giá, đỗ xe… lấy từ botFacts của Messenger), đặt lịch, xác nhận SMS.
- Turn-based (khách nói → bot nghe → bot trả lời). Hơi có độ trễ giữa các lượt, chưa ngắt lời được.

**Nâng cấp sau (khi có nhu cầu):**
- **Twilio ConversationRelay** (WebSocket) → giọng tự nhiên, độ trễ thấp, ngắt lời được.
- **Xác thực chữ ký Twilio** (`X-Twilio-Signature`) cho webhook — nên thêm trước khi mở rộng nhiều tiệm.
- **Thời lượng cuộc gọi** qua Twilio *status callback* (hiện chưa lưu `durationSec`).
- **Chuyển máy người thật** (bot `end_call` khi khách yêu cầu — hiện chỉ báo "sẽ gọi lại").
- Chất lượng tiếng Việt: đặt `language = vi-VN` trong trang AI Hotline nếu khách chủ yếu nói tiếng Việt.

---

## 7. Kiến trúc & tenant isolation

- **Bảng mới:** `voice_lines` (1 dòng/tiệm: số Lumio, bật/tắt, lời chào, ngôn ngữ, ghi chú) + `voice_calls` (log mỗi cuộc: số gọi đến, kết quả, appointmentId, transcript). Cả hai đều có `tenantId` + FK cascade.
- **Cách ly:** mỗi số Lumio (`lumioNumber @unique`) → đúng 1 tenant. Mọi truy vấn của agent (`services`, `createForTenant`, `customer`) đều scoped theo `tenantId`. Admin chỉ thấy line + calls của tiệm mình (`resolveTenantScope`). Super Admin gán số có kiểm tra trùng số giữa các tiệm.
- **Endpoints:** `POST /api/voice/incoming`, `POST /api/voice/turn` (public, Twilio) · `GET /api/voice`, `POST /api/voice/settings`, `GET /api/voice/calls` (Salon Admin) · `POST /api/admin/voice/provision` (Super Admin).

---

## 8. Checklist lên live

- [ ] `deploy.bat` → Render build xanh, migration chạy.
- [ ] `ANTHROPIC_API_KEY` có trên Render (đã có).
- [ ] Mua 1 số Twilio, set Voice webhook = `…/api/voice/incoming`.
- [ ] `/super-admin/voice` → gán số cho 1 tiệm test.
- [ ] Gọi thẳng số Lumio → bot đặt lịch thử → kiểm tra Calendar + SMS.
- [ ] Tiệm bật hotline + cài forwarding khi-không-trả-lời.
- [ ] (Khuyến nghị) luật sư xem kịch bản disclosure trước khi bán rộng.
