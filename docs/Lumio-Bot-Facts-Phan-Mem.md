# Facts cần dán vào bot bán hàng — bảng giá phần mềm

**Vì sao cần dán tay:** giá là dữ liệu của tiệm, không phải của code. Bot chỉ được nói những con số nằm trong mục **Facts** ở dashboard. Hiện Facts của Lumio Agency **chỉ có các gói marketing**, nên khi khách hỏi giá AI Messenger, bot không có lựa chọn nào khác ngoài việc nói $179 — con số đúng với thứ nó biết, và sai với thứ khách hỏi.

**Vào đâu:** Dashboard → Messenger → mục **Facts** (danh sách bật/tắt từng dòng).

**Quan trọng — nhãn phải bắt đầu bằng "Phần mềm".** Bot phân ba bảng giá bằng chữ đầu của nhãn: `Phần mềm …` là sản phẩm bán lẻ, `Gói …` là dịch vụ marketing, `Website …` là làm web. Đặt sai chữ đầu thì thẻ giá gửi cho khách sẽ lẫn lộn hai bảng.

---

## Ba dòng cần thêm

Chép đúng cột **Nhãn** và **Nội dung**, mỗi dòng một fact:

| Nhãn | Nội dung |
|---|---|
| `Phần mềm Starter` | `$29/tháng. Tiệm nhỏ & mới mở. Đặt lịch online 24/7, lịch & CRM khách hàng, xác nhận qua email, QR đánh giá Google, app mọi thiết bị, 100 SMS/tháng. Chưa có bot AI Messenger.` |
| `Phần mềm Pro` | `$69/tháng. Phổ biến nhất, cho tiệm dịch vụ đầy đủ. Có tất cả của Starter, cộng POS & thanh toán, khách vãng lai & danh sách chờ, lương thợ & tip, marketing & giới thiệu, và BOT ĐẶT LỊCH AI QUA MESSENGER — đây là gói rẻ nhất có AI Messenger.` |
| `Phần mềm Premium` | `$149/tháng. Nhiều chi nhánh + AI đầy đủ. Có tất cả của Pro, cộng Hotline AI 300 phút, nhiều chi nhánh + báo cáo, hỗ trợ ưu tiên, sẵn sàng white-label, 1.500 SMS/tháng.` |

Thêm một dòng nữa để bot không nói mâu thuẫn giữa hai bảng giá:

| Nhãn | Nội dung |
|---|---|
| `Phần mềm và gói marketing` | `Đây là hai sản phẩm riêng. Tiệm có thể mua phần mềm riêng theo tháng ($29/$69/$149), hoặc lấy gói marketing và được tặng kèm phần mềm theo từng mức. Khách hỏi giá một tính năng của phần mềm (AI Messenger, đặt lịch online, POS, nhắc hẹn) thì nêu giá phần mềm trước, rồi mới nói thêm về gói marketing.` |

---

## Còn phải kiểm lại: các dòng marketing đang có

Trong Facts hiện tại có thể còn câu ngụ ý **phải mua gói marketing mới có hệ thống Booking**. Câu đó nay **không còn đúng** — phần mềm bán riêng được. Hãy đọc lại các fact bắt đầu bằng `Gói …` và sửa những chỗ như vậy.

Cách nói đúng, gợi ý: *"Gói Boost $179/tháng đã bao gồm sẵn hệ thống Booking, nên tiệm không phải trả riêng $69."* — nói **tặng kèm**, đừng nói **chỉ có cách này mới có**.

---

## Ảnh thẻ giá (không bắt buộc)

Khi khách hỏi giá, bot gửi thẻ hình vuốt ngang trong Messenger. Ba gói phần mềm hiện **chưa có ảnh** nên sẽ hiện thẻ chữ — vẫn chạy bình thường. Muốn có ảnh thì đặt ba file vào thư mục `apps/web/public/cards/`:

- `plan-starter.png`
- `plan-pro.png`
- `plan-premium.png`

Kích thước 1200×628, giống các thẻ marketing đang có. Sau khi đổi ảnh nhớ tăng `CARD_IMG_VERSION` trong `messenger.service.ts` — Meta lưu ảnh theo URL và sẽ phục vụ bản cũ mãi nếu URL không đổi.

---

## Cách thử lại sau khi dán

Nhắn cho Page đúng câu khách đã hỏi: **"Giá của Lumio AI Messenger là bao nhiêu?"**

Câu trả lời đạt yêu cầu phải:

1. Nêu **$69/tháng (gói Pro)** trước — con số nhỏ và đúng với thứ khách hỏi
2. Rồi mới nói thêm một câu rằng gói marketing từ $179 được tặng kèm
3. Không nêu $179 trước $69

Nếu bot vẫn nói $179 trước, nghĩa là Facts chưa lưu hoặc chưa bật (nút bật/tắt từng dòng).
