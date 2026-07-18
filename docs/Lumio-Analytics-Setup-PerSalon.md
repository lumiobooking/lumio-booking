# Đo lường đặt lịch theo từng tiệm (GA4 + GTM) — không lẫn, không trùng

Mục tiêu: mỗi tiệm đo lường đặt lịch **độc lập** để bạn chạy ads cho từng khách hàng mà số liệu **không trộn lẫn** và **không đếm đôi**.

---

## Nguyên tắc vàng
1. **Mỗi tiệm = 1 GA4 property + 1 GTM container riêng.** Không bao giờ dùng chung.
2. Dán ID vào **Lumio → (đăng nhập tài khoản tiệm) → Integrations → Google Analytics & Tag Manager**. Trang đặt lịch chỉ nạp GA4/GTM **của tiệm đó** → tiệm A không bao giờ báo về property tiệm B.
3. Khi khách đặt xong, Lumio tự bắn **1 sự kiện chuẩn**: `booking_completed` (GA4: `purchase`) kèm:
   - `transaction_id` = mã đơn đặt (⇒ GA4 **tự khử trùng** nếu event bắn lại)
   - `value` = tổng tiền, `currency` = tiền tệ, `items` = danh sách dịch vụ.
4. **Mỗi tiệm chỉ đếm chuyển đổi ở MỘT nơi** (trong iframe *hoặc* trên web tiệm) — đừng bật cả hai cho cùng một tiệm.

---

## A. Tạo tài sản đo lường (làm 1 lần cho mỗi tiệm)
1. **GA4:** Google Analytics → Admin → *Create property* (đặt tên = tên tiệm) → tạo *Web data stream* → copy **Measurement ID** dạng `G-XXXXXXXXXX`.
2. **GTM (khuyên dùng):** tagmanager.google.com → *Create container* (Web) → copy **Container ID** dạng `GTM-XXXXXXX`.

## B. Dán vào Lumio
Đăng nhập **tài khoản của tiệm** → **Integrations** → mục **📊 Google Analytics & Tag Manager** → dán `G-…` và/hoặc `GTM-…` → **Lưu**.
> Từ giờ trang `lumiobooking.com/book/<tiệm>` chỉ nạp đúng GA4/GTM này.

## C. Biến sự kiện thành chuyển đổi
**Nếu dùng GA4 trực tiếp:** vào GA4 → Admin → *Events* → bật *Mark as key event* cho `purchase`. Xong — đó là chuyển đổi.

**Nếu dùng GTM:**
1. *Triggers* → New → **Custom Event** → Event name: `booking_completed`.
2. *Tags* → New → **GA4 Event** (Event name `purchase`, map `value`/`currency`/`transaction_id` từ Data Layer Variables) → gắn trigger trên.
3. (Tuỳ chọn) thêm tag **Google Ads Conversion** cũng dùng trigger `booking_completed`.
4. *Submit* để publish container.

## D. Google Ads
- Cách 1 (gọn): Google Ads → *Goals → Conversions* → **Import** chuyển đổi từ GA4 (`purchase`).
- Cách 2: dùng tag **Google Ads Conversion** trong GTM (mục C3).
- Trong campaign của tiệm, chọn đúng chuyển đổi đó làm mục tiêu tối ưu.

---

## E. Form nhúng trên WordPress — chọn 1 trong 2 cách

**Cách 1 — Đơn giản (mặc định):** chỉ cần đã dán ID ở bước B. GA4/GTM chạy **bên trong iframe** và báo về property của tiệm. Không cần làm gì thêm.

**Cách 2 — Attribution ads chuẩn hơn (khuyên khi chạy Google Ads):** để chuyển đổi bắn trong **domain của tiệm** (đúng session người click ads), dán đoạn này vào web tiệm (GTM của tiệm → *Custom HTML tag*, trigger All Pages):

```html
<script>
window.addEventListener('message', function (e) {
  // chỉ nhận từ Lumio
  if (e.origin !== 'https://lumiobooking.com') return;
  if (!e.data || e.data.type !== 'lumio:booking_completed') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'booking_completed',
    transaction_id: e.data.transaction_id,
    value: e.data.value,
    currency: e.data.currency,
    items: e.data.items
  });
});
</script>
```
Rồi tạo **Custom Event trigger** `booking_completed` trên GTM của web tiệm → bắn GA4 `purchase` / Google Ads Conversion.
> ⚠️ Nếu dùng Cách 2 thì **để trống ID trong Lumio** (hoặc chấp nhận: GA4 dùng `transaction_id` nên trùng đơn sẽ tự gộp). Đừng đếm chuyển đổi ở cả iframe lẫn web tiệm cho cùng một tiệm.

---

## F. Tránh trùng / lẫn số liệu — checklist
- [ ] Mỗi tiệm 1 property + 1 container **riêng** (không share).
- [ ] Chỉ đếm ở **1 nơi**/tiệm (iframe **hoặc** web tiệm).
- [ ] Chuyển đổi dùng `transaction_id` (đã có sẵn) → GA4 tự khử đơn trùng.
- [ ] Không gắn 1 GA/GTM “tổng” lên app đặt lịch dùng chung.

## G. Kiểm tra
- **GA4 DebugView** (bật *Debug mode* hoặc extension GA Debugger) → đặt thử 1 lịch → thấy event `purchase` với `value`/`transaction_id`.
- **GTM Preview** → đặt thử → thấy `booking_completed` kích hoạt tag.
- Đặt lại **cùng một đơn** (reload) không tạo chuyển đổi mới (nhờ `transaction_id`).

---

### Sự kiện Lumio bắn ra (tham chiếu)
```
dataLayer: { event: 'booking_completed', transaction_id, value, currency, items:[{item_name, price, quantity}] }
GA4:        gtag('event','purchase', { transaction_id, value, currency, items })
postMessage → parent: { type:'lumio:booking_completed', transaction_id, value, currency, items }
```
