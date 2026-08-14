# Đưa Lumio Booking vào thị trường Việt Nam — đánh giá kỹ thuật

Ngày soát: 12/08/2026. Soát trên code đang chạy.

> **Giới hạn của tài liệu này:** phần **kỹ thuật** dưới đây tôi đã kiểm chứng bằng cách chạy thử trên chính code của bạn — có bằng chứng cụ thể. Phần **thị trường** (Zalo, VietQR, quy định pháp lý) tôi **chưa kiểm chứng được** vì công cụ tra cứu hết hạn mức trong phiên này. Những mục đó tôi ghi rõ là *cần kiểm chứng*, đừng ra quyết định dựa vào chúng cho tới khi tra lại.

---

# Kết luận ngắn

Hệ thống **chưa chạy được cho Việt Nam**, và không phải vì thiếu tính năng — mà vì **hai giả định gắn cứng ở tầng thấp**: tiền có 2 số thập phân, và số điện thoại là số Mỹ. Cả hai nằm ở lớp dùng chung, nên sửa một chỗ là cả hệ thống theo.

Tin tốt: **giao diện tiếng Việt đã có sẵn** (nút EN/VI trên dashboard), và hơn 1.700 dòng chữ đã dịch. Đây là phần tốn công nhất và bạn đã làm xong.

---

# LỖI 1 — Tiền VND bị hiển thị sai 100 lần

**Mức độ: chặn hoàn toàn. Phải sửa trước mọi thứ khác.**

Hàm hiển thị giá trong `apps/web/src/lib/ui.ts`:

```ts
export function formatPrice(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
```

Toàn hệ thống lưu tiền dạng **cent** (đơn vị nhỏ nhất), rồi chia 100 khi hiển thị. Đúng với USD/CAD. **VND không có đơn vị nhỏ hơn đồng** — không có "xu".

Tôi chạy thử:

```
Giá thật 250.000 ₫ → lưu 250000
  formatPrice hiện tại  ->  VND 2,500.00      ← SAI, thiếu 100 lần
  đúng phải là          ->  250.000 ₫
```

Hệ quả nếu bỏ qua: một bộ gel 250.000 ₫ hiện trên trang đặt lịch của khách là **2.500 ₫**. Khách bấm đặt, tiệm mất tiền.

**Mức độ lan rộng:** 23 chỗ trong giao diện chia `/100` rồi `.toFixed(2)`, 13 cột trong database mặc định `USD`, 92 chỗ nhắc tới `'USD'`.

**Cách sửa đúng:** viết một hàm tiền tệ duy nhất biết **số chữ số thập phân theo từng loại tiền** (VND = 0, USD/CAD = 2), và bắt mọi chỗ đi qua nó. Không sửa rải rác 23 chỗ — làm vậy sẽ sót, và sót ở chỗ tiền là mất tiền thật.

---

# LỖI 2 — Số điện thoại Việt Nam biến thành số Mỹ giả

**Mức độ: chặn. Tin nhắn sẽ gửi sai người hoặc thất bại âm thầm.**

Hàm chuẩn hoá số trong `twilio.provider.ts` (và một bản y hệt trong `voice.service.ts`):

```ts
if (digits.length === 10) return `+1${digits}`;  // mặc định coi 10 số là số Mỹ
```

Số di động Việt Nam viết kiểu bình thường — `0912 345 678` — đúng **10 chữ số**. Tôi chạy thử:

| Khách gõ | Hệ thống hiểu thành | Đúng phải là |
|---|---|---|
| `0912 345 678` | `+10912345678` ❌ | `+84912345678` |
| `0912345678` | `+10912345678` ❌ | `+84912345678` |
| `091 234 5678` | `+10912345678` ❌ | `+84912345678` |
| `+84912345678` | `+84912345678` ✅ | — |

Nghĩa là: khách Việt nhập số theo cách tự nhiên nhất thì **100% sai**. Chỉ đúng khi khách tự gõ `+84` — điều gần như không ai làm.

Nguy hiểm hơn lỗi tiền ở một điểm: nó **không báo lỗi**. Số `+10912345678` vẫn là số hợp lệ về hình thức, Twilio nhận rồi gửi thất bại hoặc gửi tới đâu đó. Tiệm tưởng đã nhắc hẹn cho khách, khách không nhận được gì, rồi không đến.

**Cách sửa:** mã quốc gia phải lấy từ **cài đặt quốc gia của tiệm**, không đoán theo độ dài. Tiệm ở VN thì 10 số bắt đầu bằng `0` → bỏ `0`, thêm `+84`.

---

# LỖI 3 — 115 chỗ gắn cứng định dạng Mỹ

**Mức độ: không chặn, nhưng làm sản phẩm trông như hàng dịch máy.**

115 chỗ trong giao diện gọi `'en-US'` để hiển thị ngày và giờ. Kết quả với người Việt:

| Hiện tại | Người Việt quen |
|---|---|
| `8/12/2026` | `12/08/2026` |
| `2:00 PM` | `14:00` |
| `Mon, Aug 12` | `Thứ Hai, 12/8` |

Ngày `8/12/2026` là chỗ nguy hiểm nhất: người Việt đọc thành **8 tháng 12**, hệ thống nói **12 tháng 8**. Lịch hẹn sai bốn tháng mà không ai thấy sai.

---

# Những thứ ĐÃ sẵn sàng

Không phải làm lại từ đầu. Các phần này đã đúng kiến trúc:

| Hạng mục | Trạng thái |
|---|---|
| Giao diện tiếng Việt | **Đã có**, nút EN/VI, hơn 1.700 chuỗi đã dịch |
| Trường loại tiền tệ | Đã có trong database theo từng tiệm — chỉ thiếu logic hiển thị |
| Phụ phí thẻ +3% | **Bật/tắt được** theo tiệm, không gắn cứng — tiệm VN tắt là xong |
| Múi giờ | Theo từng tiệm, không gắn cứng (mặc định `America/*`, đổi được) |
| Đa tiệm, tách dữ liệu | Không liên quan quốc gia, dùng lại nguyên |
| Chia turn thợ, POS, waitlist | Nghiệp vụ giống nhau, dùng lại được |

---

# CẦN KIỂM CHỨNG trước khi quyết định

Những mục dưới đây tôi **chưa tra được** trong phiên này. Đừng lên kế hoạch dựa vào chúng cho tới khi kiểm chứng lại.

## Kênh nhắn tin

Ở Mỹ bạn dùng Messenger + SMS. Ở Việt Nam **Zalo** là kênh doanh nghiệp phổ biến hơn Messenger nhiều — nhưng cần tra rõ:

- Zalo OA (Official Account) hiện cho gửi tin nhắn giao dịch tới khách thế nào, điều kiện gì
- Zalo ZNS (dịch vụ gửi thông báo) chi phí và thủ tục đăng ký mẫu tin
- SMS brandname ở VN: thủ tục, chi phí, có bắt buộc đăng ký mẫu không

Đây là hạng mục **lớn nhất về khối lượng công việc** nếu phải làm — tương đương xây lại phần Messenger bot cho một nền tảng mới.

## Thanh toán

- Chuyển khoản QR (VietQR) — chuẩn hiện hành, cách tạo mã, có cần qua trung gian không
- MoMo / ZaloPay / VNPay — cái nào cần cho tiệm nail/spa nhỏ
- Thẻ tín dụng gần như không dùng ở tiệm nail VN → phần phụ phí thẻ nên tắt mặc định

## Pháp lý

- Quy định bảo vệ dữ liệu cá nhân hiện hành ở VN và yêu cầu về **sự đồng ý** khi gửi tin nhắn quảng cáo
- Hoá đơn điện tử: tiệm nail/spa quy mô nhỏ có bắt buộc không
- Có yêu cầu tiết lộ AI khi tổng đài tự động trả lời không (ở Mỹ là có, California/Texas)

## Thói quen người dùng

- Khách Việt đặt lịch qua chat nhiều hơn qua form web — nếu đúng, **Zalo bot quan trọng hơn trang đặt lịch**
- Văn hoá tip: tiệm nail VN thường không tip → nên có công tắc **ẩn toàn bộ phần tip** trong POS (hiện tip nằm ở 7 file giao diện)

---

# Thứ tự làm — nếu quyết định triển khai

**Giai đoạn 1 — sửa nền (không sửa xong thì mọi thứ khác vô nghĩa)**

1. Một hàm tiền tệ duy nhất, biết số thập phân theo loại tiền. Bắt 23 chỗ đi qua nó.
2. Chuẩn hoá số điện thoại theo **quốc gia của tiệm**, bỏ giả định `+1`.
3. Định dạng ngày/giờ theo ngôn ngữ đang chọn, gỡ 115 chỗ `en-US`.
4. Công tắc ẩn phần tip theo tiệm.

Sau giai đoạn này, hệ thống chạy được cho một tiệm VN với thanh toán tiền mặt và nhắc hẹn qua Messenger.

**Giai đoạn 2 — thanh toán**: QR chuyển khoản, sau khi đã kiểm chứng chuẩn nào phù hợp.

**Giai đoạn 3 — Zalo**: chỉ làm sau khi đã có tiệm VN dùng thật và xác nhận Zalo là kênh họ cần. Đây là hạng mục nặng nhất, đừng làm dựa trên phỏng đoán.

---

# Một lời khuyên về cách vào thị trường

Đừng làm cả ba giai đoạn rồi mới đi bán. **Làm xong Giai đoạn 1 rồi tìm một tiệm ở Việt Nam dùng miễn phí ba tháng.** Ba tháng đó sẽ cho bạn biết Zalo có thật sự cần thiết không, khách có chịu đặt qua web không, tiệm có cần hoá đơn không — những câu mà bây giờ tôi lẫn bạn đều chỉ đang đoán.

Xây Giai đoạn 3 trước rồi phát hiện tiệm VN không dùng nó là mất vài tháng công.
