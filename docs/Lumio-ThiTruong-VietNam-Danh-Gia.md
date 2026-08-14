# Đưa Lumio Booking vào thị trường Việt Nam — đánh giá kỹ thuật

Ngày soát: 12/08/2026. Cập nhật 14/08/2026. Soát trên code đang chạy.

> **Tình trạng:** phần **kỹ thuật** đã kiểm chứng bằng cách chạy thử trên chính code của bạn. Phần **thị trường** (Zalo, VietQR, pháp lý) đã tra nguồn ngày 14/08/2026 — xem mục *ĐÃ KIỂM CHỨNG*. Chỗ nào vẫn chưa chắc thì ghi rõ là chưa chắc.
>
> **Giai đoạn 1 đã LÀM XONG** ngày 14/08/2026 (4 commit). Chi tiết ở cuối tài liệu.

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

# ĐÃ KIỂM CHỨNG — tra ngày 14/08/2026

Phần này trước đây là phỏng đoán. Nay đã tra nguồn. Chỗ nào vẫn chưa chắc, tôi ghi rõ là chưa chắc.

## Zalo — kết luận quan trọng nhất: OA là của TIỆM, không phải của bạn

Zalo OA xác thực **bắt buộc có Giấy đăng ký kinh doanh Việt Nam**, và tên OA phải trùng tên trên giấy ĐKKD (hoặc nhãn hiệu đã đăng ký với Cục Sở hữu trí tuệ). OA mới có **14 ngày** để nộp hồ sơ xác thực. Zalo duyệt trong **2–3 ngày làm việc**.

Lumio là công ty Mỹ, nên **bạn không tự đăng ký OA thay khách được**. Nhưng đây không phải rào cản — nó chỉ đường cho kiến trúc:

> **Mỗi tiệm tự đăng ký OA của mình rồi kết nối vào Lumio — y hệt cách họ kết nối Trang Facebook hôm nay.**

Nghĩa là phần Zalo không cần pháp nhân Việt Nam, và nó khớp sẵn với mô hình đa tiệm: mỗi tenant một OA, giống mỗi tenant một Messenger page.

**Chi phí ZNS (tin nhắn thông báo):** trả theo tin **gửi thành công**, khoảng **200–800đ/tin** tuỳ loại mẫu và thành phần. Nút CTA đầu tiên miễn phí; nút thêm, ảnh, voucher đều cộng tiền — một mẫu đầy đủ có thể lên tới ~1.100đ/tin. Gói OA từ khoảng 10.000đ/tháng.

Để so sánh: một tin nhắc hẹn ~300–500đ, tức khoảng **1,2–2 cent Mỹ** — rẻ hơn SMS Twilio ở Mỹ. Chi phí không phải vấn đề; **công sức tích hợp mới là vấn đề**.

## Thanh toán — VietQR có API, không cần trung gian bắt buộc

VietQR có API chính thức (`api.vietqr.vn`) cho phép tạo mã QR chuyển khoản và **nhận thông báo biến động số dư theo thời gian thực** để tự đối soát. Có sẵn plugin cho WooCommerce, Sapo, Haravan. Ngoài ra có cổng trung gian như SePay nếu không muốn tự nối ngân hàng.

Đây là tin tốt: **Lumio đã có sẵn phần "chuyển khoản + QR" trong POS** (`transferInstructions`, `transferQrUrl`). Bước đầu cho tiệm VN có thể chỉ là **dán mã VietQR tĩnh** vào ô đã có — chạy được ngay, không cần code gì thêm. Tự động đối soát là bước sau, khi có tiệm thật dùng.

**Vẫn chưa chắc:** MoMo/ZaloPay có cần cho tiệm nail nhỏ không. Chưa có dữ liệu, đừng đoán.

## Pháp lý — luật đã ĐỔI, tài liệu cũ của tôi lỗi thời

Đây là chỗ tôi suýt dẫn bạn đi sai.

- **Nghị định 13/2023 đã HẾT HIỆU LỰC từ 01/01/2026.**
- Thay bằng **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15**, Quốc hội thông qua 26/06/2025, hiệu lực **01/01/2026**, hướng dẫn bởi **Nghị định 356/2025/NĐ-CP**.

Hai điều ảnh hưởng trực tiếp tới Lumio:

**1. Luật áp dụng NGOÀI lãnh thổ.** Tổ chức nước ngoài xử lý dữ liệu cá nhân của công dân Việt Nam thuộc phạm vi điều chỉnh. Lumio là công ty Mỹ, cơ sở dữ liệu đặt ngoài Việt Nam — **vẫn thuộc diện áp dụng** khi phục vụ tiệm Việt Nam.

**2. Chuyển dữ liệu xuyên biên giới cần hồ sơ đánh giá tác động** (Mẫu số 09 theo Nghị định 356/2025). Dữ liệu khách của tiệm Việt nằm trên Neon ở nước ngoài chính là chuyển xuyên biên giới.

**Về nội địa hoá dữ liệu (Nghị định 53/2022):** yêu cầu lưu trữ dữ liệu tại Việt Nam và đặt chi nhánh/văn phòng đại diện **không tự động áp dụng** — nó phát sinh khi **Bộ Công an ra quyết định yêu cầu** với từng doanh nghiệp cụ thể. Nên đây **chưa phải rào cản để bắt đầu**, nhưng là rủi ro cần biết trước nếu quy mô lớn lên.

**Việc phải làm, không phải việc nên làm:** trước khi nhận tiệm Việt Nam trả tiền, hỏi một luật sư Việt Nam về hồ sơ chuyển dữ liệu xuyên biên giới. Đây là loại việc rẻ nếu làm sớm và đắt nếu làm muộn. Tôi không phải luật sư và phần này không thay được tư vấn pháp lý.

**Chưa tra được:** hoá đơn điện tử cho tiệm nhỏ, và nghĩa vụ tiết lộ AI khi tổng đài tự trả lời ở Việt Nam.

## Thói quen người dùng — vẫn là phỏng đoán

Không tra được bằng chứng đáng tin về việc khách Việt thích đặt qua chat hơn form web. **Đây vẫn là giả định, và nó là giả định đắt nhất trong cả kế hoạch** — vì nếu đúng thì Zalo bot quan trọng hơn trang đặt lịch, còn nếu sai thì làm Zalo trước là phí vài tháng.

Chỉ một tiệm thật dùng ba tháng mới trả lời được câu này.

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

---

# Giai đoạn 1 — đã hoàn thành 14/08/2026

| Hạng mục | Tình trạng | Ghi chú |
|---|---|---|
| Một hàm tiền tệ, biết số thập phân theo loại tiền | Xong | Hai bản: `apps/web/src/lib/ui.ts` cho web, `apps/api/src/common/money.ts` cho máy chủ |
| Chuẩn hoá số điện thoại theo quốc gia của tiệm | Xong | `apps/api/src/common/phone.ts`, dùng chung cho nhắc hẹn và hotline |
| Ngày giờ theo quốc gia | Xong | Cả trang khách, trang quản lý, và tin nhắn máy chủ gửi đi |
| Công tắc ẩn tiền tip | Xong | `PosSettings.tipsEnabled`, chọn VN là tự tắt |
| Chọn quốc gia trong Cài đặt | Xong | Đổi theo: múi giờ, tiền tệ, ngôn ngữ, tip |
| Giao diện khách bằng tiếng Việt | Xong | 259 chuỗi, cả trang nail và trang đặt bàn nhà hàng |

**Ba lỗi phát hiện thêm trong lúc làm, không có trong đánh giá ban đầu:**

1. **Máy chủ báo giá sai 100 lần** — dòng `chia 100` kèm dấu `$` bị chép ra ba nơi: tin nhắn xác nhận, bot Messenger, hotline AI. Dịch vụ 200.000₫ được báo cho khách là 2.000₫.
2. **Hotline có bản chép riêng của quy tắc số điện thoại**, vẫn mặc định +1 — số Việt 10 chữ số thành số Mỹ giả, gửi đi im lặng không tới.
3. **Danh sách dịch vụ của hotline bị chặn ở 40** — cùng loại lỗi từng làm bot khẳng định một dịch vụ có thật là không tồn tại.

**Việc cần làm ở máy bạn:** chạy `npx prisma generate` rồi `npm test` — bộ test API không chạy được trong môi trường của tôi vì không tải được engine của Prisma.

---

# Bước kế tiếp — đề xuất, không phải kế hoạch

Giai đoạn 1 xong nghĩa là hệ thống **đã chạy được cho một tiệm Việt Nam** với tiền mặt/chuyển khoản và nhắc hẹn qua Messenger. Lời khuyên vẫn không đổi:

**Đừng xây Giai đoạn 2 và 3. Hãy tìm một tiệm ở Việt Nam dùng miễn phí ba tháng.**

Ba tháng đó trả lời được ba câu mà bây giờ cả tôi lẫn bạn đều đang đoán:
- Khách có chịu đặt qua trang web không, hay chỉ nhắn tin?
- Zalo có thật sự cần, hay Messenger đủ dùng?
- Tiệm có cần đối soát chuyển khoản tự động, hay dán mã VietQR tĩnh là xong?

Việc duy nhất nên làm trước khi có tiệm thật: **hỏi luật sư Việt Nam về hồ sơ chuyển dữ liệu cá nhân xuyên biên giới.** Rẻ nếu làm sớm, đắt nếu làm muộn.
