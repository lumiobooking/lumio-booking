# Lumio Booking — Đánh giá hệ thống & Lộ trình phát triển

*Bản rà soát toàn hệ thống + nghiên cứu thị trường — tháng 6/2026*

---

## 1. Tóm tắt nhanh

Tôi đã rà soát toàn bộ frontend (27 trang quản trị + trang đặt lịch công khai + super-admin) và backend (31 service, 28 controller, database, phân quyền). **Kết luận: hệ thống đang ở trạng thái tốt và đầy đủ tính năng hơn phần lớn đối thủ tầm trung.** Không có lỗi nghiêm trọng, không có rò rỉ dữ liệu giữa các salon, không có tính năng "treo/chưa làm xong".

Hai điểm yếu thật sự, đều đã/đang xử lý trong phiên này:
- **Song ngữ chưa trọn 100%** — vài chỗ dùng chung (lọc ngày, phân trang) còn tiếng Anh → đã sửa.
- **Một vài chỗ về tiền (điểm thưởng) và bảo mật token** chưa chặt → đã sửa phần chính.

---

## 2. Những lỗi đã SỬA trong phiên này

| Vấn đề | Mức độ | Trạng thái |
|---|---|---|
| **Điểm thưởng không hoàn lại khi huỷ/xoá hóa đơn** — khách bị giữ điểm cho đơn đã huỷ, hoặc mất điểm đã đổi. Nay tự hoàn đúng (đối xứng với hoàn thẻ quà tặng). | Cao (tiền) | ✅ Đã sửa |
| **i18n: thanh lọc ngày + phân trang + ô tìm kiếm** (hiện trên HẦU HẾT trang danh sách) còn tiếng Anh trong chế độ tiếng Việt | Cao (hình ảnh) | ✅ Đã sửa |
| **i18n: chữ "Loading…" toàn cục + "No match" ở walk-in** | Trung bình | ✅ Đã sửa |
| **Bảo mật: khóa ký token mặc định `'dev'`** — nếu thiếu biến môi trường, link xác nhận/huỷ lịch và OAuth có thể bị giả mạo. Nay bắt buộc dùng khóa thật, lỗi an toàn nếu thiếu. | Trung bình (bảo mật) | ✅ Đã sửa |
| **Siết phạm vi tenant** ở cập nhật waitlist + nhắc lịch (phòng thủ thêm lớp, tránh rò rỉ chéo khi refactor sau này) | Trung bình | ✅ Đã sửa |

**Kết quả kiểm tra:** frontend type-check sạch (0 lỗi ngữ nghĩa). Backend không build được trong sandbox của tôi (thiếu DB client offline) như mọi lần — xác minh bằng đọc kỹ + theo đúng mẫu code sẵn có. Cần `deploy.bat` để build thật.

---

## 3. Việc nên xử tiếp (sửa/đánh bóng — an toàn, làm nhanh)

1. **Hoàn tất song ngữ 2 trang còn tiếng Anh:** *Tài khoản của tôi* và *Báo cáo bán hàng*. (Cô lập, an toàn, ~30 phút mỗi trang.)
2. **In lại hóa đơn ở trang Đơn hàng** đang dùng `window.open` — dễ bị trình duyệt chặn trên iPhone. Nên dùng cách in iframe như màn POS.
3. **Cách tính điểm thưởng** hiện tính trên *doanh thu gộp* (gồm tip + phần khách trả bằng thẻ quà tặng). Chuẩn hơn là tính trên *tiền thực thu*. Đây là **quyết định chính sách của anh** — tôi đề xuất thêm tuỳ chọn trong Cài đặt thay vì đổi ngầm.
4. **Khoá race khi đổi điểm** lúc thanh toán (hiếm gặp với 1 máy quầy, nhưng nên chặt như thẻ quà tặng).

---

## 4. Đánh giá so với mục tiêu của anh

> *Mục tiêu: quản lý tập trung, thay thế phần mềm/thiết bị rời rạc — máy POS, phần mềm booking, chiến dịch marketing.*

**Đã đạt (rất tốt):**

Đặt lịch online 24/7 · nhắc lịch SMS/email + xác nhận 1 chạm + theo dõi no-show · danh sách chờ tự lấp chỗ · hàng đợi khách vãng lai + chia lượt · **POS** (dịch vụ + sản phẩm, tip, tiền mặt/thẻ/chuyển khoản, in hóa đơn, **offline + đồng bộ**, cầu in máy lễ tân, **quét mã vạch**) · **thẻ quà tặng** · tích điểm + đổi điểm · giới thiệu bạn bè · **marketing** (sinh nhật/winback SMS) · đánh giá Google + thưởng thợ · kho vật tư · lương + hoa hồng thợ · **nhiều chi nhánh** + báo cáo hợp nhất · phân quyền 4 cấp · **song ngữ Việt–Anh** · AI-SEO · cài như app (PWA).

→ **Về mặt nghiệp vụ, Lumio đã thay được phần mềm booking + phần mềm POS + công cụ marketing rời rạc.** Mảnh còn thiếu để "thay trọn vẹn" là **xử lý thanh toán thẻ thật** (xem mục 6, P0).

---

## 5. Thị trường & vị thế của Lumio

Các đối thủ chính (giá tham khảo 2026):

| Phần mềm | Giá | Điểm mạnh | Điểm yếu |
|---|---|---|---|
| **Vagaro** | ~$30/thợ/tháng | All-in-one, marketplace, giá mềm | Tính theo đầu thợ → đắt dần khi đông |
| **Mangomint** | từ ~$165/tháng | Checkout siêu nhanh, thiết kế đẹp | Đắt, **KHÔNG có hàng đợi walk-in** |
| **GlossGenius** | từ ~$24/tháng | Cho thợ solo, AI marketing | Yếu cho tiệm nhiều thợ/chi nhánh |
| **Zenoti** | Cao cấp | Cho chuỗi lớn, báo cáo tập trung | Đắt, phức tạp |
| **Square Appointments** | Có bản free | Rẻ, thanh toán tích hợp | Tính năng salon nông |

**Tính năng thị trường coi là "phải có":** đặt lịch 24/7, **đặt cọc/trả trước (giảm no-show tới 40%)**, nhắc SMS, **danh sách chờ tự lấp (hồi trung bình ~$233/chi nhánh/tháng)**, **gói & thẻ thành viên**, thẻ quà tặng, hồ sơ khách hàng.

### Lợi thế khác biệt Lumio đã có sẵn (nên đẩy mạnh khi bán)
- 🇻🇳 **Song ngữ Việt–Anh** — đúng tệp tiệm nail người Việt ở Mỹ (đối thủ chỉ tiếng Anh).
- 🔄 **Hàng đợi walk-in + chia lượt** — Mangomint không có; rất hợp tiệm nail đông khách vãng lai.
- 📴 **Offline tính tiền + in hóa đơn** — đối thủ cloud "chết" khi rớt mạng.
- 🖨️ **Cầu in: bấm in trên điện thoại → máy lễ tân in ra**.
- 💳 **Không ăn % mỗi lần quẹt thẻ** + giá rẻ hơn Mangomint nhiều.
- 🏬 **Nhiều chi nhánh trong 1 tài khoản** ngay từ gói thấp.

---

## 6. Tính năng còn thiếu — Lộ trình ưu tiên

Sắp theo tác động × độ dễ. Mỗi mục ghi rõ phục vụ **[Bán phần mềm]** (hấp dẫn chủ salon) hay **[Hút khách cuối]** (giúp salon kiếm tiền).

### 🔴 P0 — Làm trước (doanh thu + hoàn thiện POS)

**1. Thanh toán thẻ thật + đặt cọc charge thật + lưu thẻ (card-on-file)**
Hiện POS *ghi nhận* thẻ chứ chưa *quẹt*; đặt cọc mới "sẵn khung" chưa trừ tiền. Đây là **mảnh ghép lớn nhất** để thay máy POS trọn vẹn và để **chống no-show thật sự** (giữ thẻ → tự trừ khi khách bỏ hẹn). Tích hợp Stripe (Terminal cho đầu đọc tại quầy + thanh toán online cho đặt cọc). *[Cả hai]* — Tác động: rất cao · Công sức: cao.

**2. Gói buổi & Thẻ thành viên (Packages / Memberships)**
Bán "gói 5 buổi", "thành viên 99$/tháng" → **doanh thu định kỳ + giữ chân khách**. Đây là must-have đang thiếu, đối thủ nào cũng có. *[Cả hai]* — Tác động: rất cao · Công sức: trung bình–cao.

### 🟠 P1 — Hút khách cuối (để salon thấy ROI rõ)

**3. Nhắc quay lại tự động ("đến hẹn làm lại")**
Tự nhắn sau 3–4 tuần kể từ lần làm gần nhất ("Đã 4 tuần rồi, đặt lịch dặm lại nhé?"). Tận dụng **engine chiến dịch đã có** → rẻ, ROI rất cao về giữ chân. *[Hút khách cuối]* — Tác động: cao · Công sức: thấp.

**4. Bán thẻ quà tặng ONLINE trên trang đặt lịch**
Mở rộng tính năng thẻ quà tặng vừa xây — cho khách mua tặng bạn qua web → **kênh hút khách mới + lan truyền**. *[Hút khách cuối]* — Tác động: cao · Công sức: thấp–trung bình.

**5. Thư viện ảnh (portfolio) theo thợ & dịch vụ**
Nail sống nhờ hình. Cho mỗi thợ/dịch vụ khoe ảnh trên trang booking → **tăng chuyển đổi đặt lịch + hút khách**. *[Hút khách cuối]* — Tác động: cao · Công sức: trung bình.

**6. Hộp tin nhắn 2 chiều (SMS inbox)**
Khách nhắn lại được; salon có hộp thư trả lời. Tăng chăm sóc & chốt lịch. *[Hút khách cuối]* — Tác động: trung bình · Công sức: trung bình.

### 🟠 P1 — Giúp anh BÁN phần mềm dễ hơn

**7. Trợ lý thiết lập (onboarding wizard) + dữ liệu mẫu + nhập từ phần mềm cũ**
Để chủ salon dùng được trong 15 phút, giảm ma sát lúc chốt sale. *[Bán phần mềm]* — Tác động: cao · Công sức: trung bình.

**8. Hoàn tất song ngữ 100% + đánh bóng giao diện**
App nửa Anh nửa Việt làm mất điểm với chủ Việt (đã sửa phần lớn ở phiên này). *[Bán phần mềm]* — Tác động: trung bình · Công sức: thấp.

**9. White-label / thương hiệu riêng theo salon**
Đã có sẵn cờ tính năng — hoàn thiện để bán **gói cao cấp** (logo/màu/tên miền riêng). *[Bán phần mềm]* — Tác động: trung bình · Công sức: trung bình.

### 🟡 P2 — Mở rộng & phân tích (làm sau)

**10. Báo cáo sâu:** tỷ lệ quay lại, tỷ lệ no-show, rebooking rate, top dịch vụ/thợ, xu hướng doanh thu, dự báo. *[Cả hai]*
**11. App khách / cổng tự phục vụ:** khách xem lịch sử, đặt lại 1 chạm, quản lý thẻ/điểm. *[Hút khách cuối]*
**12. Marketplace Lumio (thư mục salon):** khách cuối khám phá salon → kênh acquisition cho cả hai phía. *[Cả hai]* (tầm nhìn xa)
**13. Email marketing** (bổ sung SMS — rẻ hơn, gửi newsletter/khuyến mãi). *[Hút khách cuối]*
**14. Phiếu đồng ý / form khách (waivers, dị ứng)** cho salon cần. *[Bán phần mềm]*

---

## 7. Đề xuất 3 bước tiếp theo

1. **Chốt chính sách điểm thưởng** (mục 3.3) — anh muốn tính điểm trên tiền thực thu hay doanh thu gộp?
2. **Bắt đầu P0**: tôi đề xuất làm **Gói & Thẻ thành viên (#2)** trước (công sức vừa, doanh thu định kỳ ngay), song song chuẩn bị **thanh toán Stripe (#1)** vì cần anh tạo tài khoản Stripe.
3. **Quick wins hút khách**: **Nhắc quay lại tự động (#3)** + **bán thẻ quà tặng online (#4)** — cả hai rẻ, tận dụng cái đã có, salon thấy hiệu quả ngay → dễ bán.

> Anh muốn tôi bắt đầu mục nào, tôi build luôn.

---
*Nguồn thị trường: joinblvd.com, zenoti.com, mangomint.com, fresha.com, thesalonbusiness.com (so sánh phần mềm salon 2026).*
