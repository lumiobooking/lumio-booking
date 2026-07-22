# Ghi nhận & đo lường Nguồn + Thiết bị đặt lịch

> Cập nhật 22/07/2026. Trả lời 3 câu hỏi: (1) vì sao chưa thấy thiết bị,
> (2) xem nguồn trên lịch tháng, (3) thống kê cuối tháng để tối ưu.

---

## 1. Vì sao "Online" mà chưa thấy thiết bị?

Các lịch trên màn hình demo được tạo *trước* bản cập nhật này, nên:

- Kênh chỉ lưu chung là **online** → thẻ hiện 🌐 "Đặt online", chưa tách được
  website hay link Lumio.
- Thiết bị **chưa từng được ghi** → không có icon 📱/💻.

Từ sau khi deploy, mỗi lịch đặt qua website hoặc link Lumio sẽ tự ghi:

| | Ghi gì |
|---|---|
| Nguồn | 🌐 Website tiệm · 🔗 Link Lumio · 📞 Hotline · 💬 Messenger · 🏪 Tại quầy |
| Thiết bị | 📱 Điện thoại · 💻 Máy tính |

**Backfill:** với lịch cũ từng lưu nhầm "web"/"mobile" vào ô nguồn, migration
`20260722100000_backfill_device_from_source` tự chuyển giá trị đó về đúng ô
thiết bị. Còn lịch seed cũ lưu "online" thì không có gì để khôi phục — vốn dĩ
chưa bao giờ ghi thiết bị.

➜ Muốn thấy đủ nguồn + thiết bị: **đặt thử một lịch mới** qua website tiệm bằng
điện thoại, và một lịch qua link Lumio bằng máy tính. Hai thẻ đó sẽ khác nhau rõ.

---

## 2. Trên lịch THÁNG

Mỗi ô lịch tháng vốn rất hẹp ("11:00 Rhonda · Builder…"), nên chỉ thêm **một
icon nguồn** ngay trước giờ (🌐 / 🔗 / 📞 / 💬 / 🏪). Rê chuột vào icon hiện tên
nguồn đầy đủ. Thiết bị không nhồi vào lịch tháng — xem ở lịch Ngày (chip đầy đủ)
hoặc trang Thống kê.

Lịch **Ngày** giữ chip đầy đủ "nguồn + thiết bị" như đã làm.

---

## 3. Thống kê cuối tháng — đo để tối ưu

Vào **Finance → Reports (Thống kê)** → chọn nhịp **Tháng**.

Trang này giờ có:

| Mục | Cho biết |
|---|---|
| **Khách theo nguồn** | Bao nhiêu % đến từ Website, Link Lumio, Hotline, Messenger, vãng lai, nhân viên nhập |
| **Khách đặt bằng thiết bị gì** *(mới)* | Tỷ lệ Điện thoại vs Máy tính |
| **Xu hướng theo thời gian** | Cột chồng theo từng tháng — nhìn được nguồn nào đang lên/xuống |
| **Doanh thu theo nguồn (POS)** | Nguồn nào ra tiền thật |

Cách đọc để tối ưu tháng sau:

- **Điện thoại chiếm đa số** (thường 70–80% với tiệm nail) → ưu tiên trải nghiệm
  đặt lịch trên điện thoại, nút Booking to rõ, form ngắn.
- **Link Lumio cao hơn Website** → khách đến từ tin nhắn/mạng xã hội nhiều hơn từ
  web → đẩy mạnh chia sẻ link, QR tại quầy.
- **Website gần như bằng 0** → kiểm tra nút Booking trên web tiệm có nổi bật không.
- **Hotline/Messenger tăng** → cân nhắc bật thêm nhắc tự động ở kênh đó.

Số liệu chỉ tính lịch **không huỷ, không no-show**, nên phản ánh khách thật.

---

## 4. Kỹ thuật (tóm tắt)

- `appointments.device` — cột mới, `mobile | web | null`, tách hẳn khỏi `source`.
- `source` giờ giữ đúng kênh: `website | lumiolink | hotline | messenger | admin | walkin` (+ `online` cho dữ liệu cũ).
- `/stats/sources` trả thêm `deviceTotals` (mobile/web/unknown) + `devices` theo từng kỳ.
- Migration additive; đã transpile sạch toàn bộ file liên quan.
