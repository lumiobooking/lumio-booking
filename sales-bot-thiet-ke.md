# Thiết kế: Sales bot cho page Lumio Agency

Mục tiêu: page Facebook của Lumio Agency có AI trực 24/7 — trả lời trong vài
giây, tư vấn sản phẩm, chốt lead cho team sale — thay vì khách chờ nhân viên
online. Dùng lại TOÀN BỘ hạ tầng Messenger đã chạy cho tiệm nail (OAuth connect,
webhook, greeting/Get Started, lịch sử hội thoại, handoff, Bot facts); chỉ thêm
một "bộ não" thứ hai.

## 1. Chế độ bot theo kết nối (botMode)

- `MessengerConnection` thêm trường `botMode: 'booking' | 'sales'` (mặc định
  `booking` — mọi tiệm nail hiện tại không đổi gì).
- Trang cài đặt `/salon/messenger` thêm ô chọn chế độ (chỉ hiện khi phiên
  Support/Super Admin — tiệm nail không cần thấy; với khách salon đây vẫn là
  mục đã ẩn theo feature-policy).
- Cách gắn page agency: tạo tenant "Lumio Agency" → connect page qua OAuth như
  một tiệm bình thường → bật `botMode = sales`.

## 2. Persona Sales (system prompt mới, server-side — khách không bao giờ thấy)

Vai: nhân viên tư vấn của Lumio Agency — phần mềm quản lý & booking cho tiệm
nail. Nguyên tắc giữ nguyên phong cách bot booking đã tinh chỉnh:

- Trả lời đúng ngôn ngữ khách (VI: dạ/ạ, anh/chị). 1–2 câu, tối đa 3.
- Mỗi tin chỉ hỏi MỘT điều; không bao giờ hỏi lại điều khách đã nói.
- CHỈ nói giá / tính năng / chính sách có trong Bot facts — thiếu thì nói
  "để team xác nhận chính xác giúp anh/chị" và ghi lead. KHÔNG BAO GIỜ bịa.
- Luồng chuẩn: chào → hỏi tiệm anh/chị đang gặp gì (đặt lịch? bỏ lỡ khách?
  POS?) → khớp 1–2 tính năng đúng nỗi đau → mời demo/để lại liên hệ.
- Chốt lead khi khách có quan tâm: xin TÊN + SĐT (+ tên tiệm, thành phố nếu
  tiện). Có đủ tên + SĐT → gọi tool `save_lead`. Không dí ép — khách từ chối
  thì cảm ơn, để ngỏ.
- Khách đòi gặp người / hỏi vượt facts / muốn thương lượng giá: nói team sẽ
  liên hệ trong hôm nay, gọi `save_lead` với ghi chú "cần người thật".
- Không hứa thời hạn triển khai, không cam kết giá ngoài facts, không nói xấu
  đối thủ, không nhận thanh toán qua chat.

## 3. Tools của chế độ Sales

| Tool | Làm gì |
|---|---|
| `save_lead` | Lưu lead: name, phone, salonName?, city?, note, interest. Ghi vào bảng `sales_leads` (tenant agency) + GỬI EMAIL ngay cho team sale (địa chỉ cấu hình trong settings kết nối) kèm 10 tin nhắn gần nhất. Chống trùng: cùng SĐT trong 7 ngày thì cập nhật, không tạo mới, không gửi lại email. |
| `get_pricing` | Trả về gói/giá từ Bot facts (chỉ để model đọc có cấu trúc — không gọi mạng). |

KHÔNG có tool đặt lịch nail, không truy cập dữ liệu tiệm nào — tenant agency là
tenant thường, isolation nguyên vẹn.

## 4. Lead lưu ở đâu, team sale làm việc thế nào

- Bảng mới `sales_leads` (tenantId, name, phone, salonName, city, note,
  interest, threadId, status: NEW/CONTACTED/WON/LOST, createdAt). Migration nhỏ.
- Trang `/salon/messenger` (tenant agency) thêm tab "Leads": danh sách, đổi
  status, bấm mở hội thoại gốc.
- Email báo lead: tiêu đề "🔥 Lead mới từ Messenger: {tên} — {SĐT}", nội dung
  kèm tóm tắt nhu cầu + link thread. Gửi qua hệ notification sẵn có.
- Nhân viên sale online lúc nào cũng được: mở threads → "Take over" (handoff
  đã có) → bot im; trả xong bấm trả lại bot.

## 5. Chào hỏi & tốc độ

- Greeting Get Started (đã làm ở đợt trước) dùng luôn, nội dung Sales:
  "Chào anh/chị 👋 Em là trợ lý của Lumio — phần mềm đặt lịch & quản lý tiệm
  nail. Anh/chị đang tìm giải pháp cho tiệm mình ạ?"
- Điều kiện tốc độ (quan trọng nhất): service `lumio-api` phải LUÔN THỨC.
  Render gói ngủ-khi-rảnh = tin đầu tiên chờ 30–60s máy dậy → cảm giác "Meta
  trễ". Nâng gói always-on hoặc bật health-ping trước khi mở bot cho page thật.

## 6. Việc KHÔNG nằm trong phạm vi (làm sau nếu cần)

- Tự đặt lịch demo vào calendar (có thể nối vào chính hệ booking của tenant
  agency ở bước 2).
- Đồng bộ lead sang CRM ngoài (Google Sheet/HubSpot).
- Instagram DM cho page agency (hạ tầng có sẵn, chỉ cần connect).

## 7. Kiểm thử bắt buộc

1. Page agency (botMode=sales): hỏi giá → trả đúng facts; hỏi ngoài facts →
   không bịa, ghi lead "cần người thật".
2. Đủ tên+SĐT → 1 dòng trong sales_leads + 1 email; nhắn tiếp không tạo lead
   trùng trong 7 ngày.
3. Page tiệm nail (botMode=booking, mặc định) → hành vi y hệt hiện tại.
4. Handoff: sale tiếp quản → bot im; trả lại → bot hoạt động.
5. Cross-tenant: bot agency không đọc được dữ liệu tiệm nào khác.

## Khối lượng dự kiến

- API: botMode + prompt sales + 2 tool + bảng leads + email (~1 buổi).
- Web: ô chọn chế độ + tab Leads (~nửa buổi).
- Test + tinh chỉnh câu chữ theo facts thật của bạn (~nửa buổi).
