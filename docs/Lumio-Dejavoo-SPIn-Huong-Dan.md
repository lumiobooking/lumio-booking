# Tích hợp máy Dejavoo P1 vào Lumio POS — Hướng dẫn đăng ký & hoàn tất

> ## ⚠️ ĐÍNH CHÍNH (21/07/2026)
>
> Bản đầu của tài liệu này nói rằng **phải đăng ký ISV mới lấy được SPIn API**.
> **Điều đó không đúng.** Tài liệu SPIn là công khai
> (`docs.ipospays.com` + `app.theneo.io/dejavoo/spin`), và **tiệm tự tạo được
> TPN + Auth Key** ngay trong cổng iPOSpays của họ.
>
> ➜ **Connector đã viết xong và test xong** mà không cần đăng ký gì.
> Xem `Lumio-Dejavoo-SPIn-API-Reference.md` (đặc tả) và
> `Lumio-Dejavoo-GiaiDoan-1.md` (trạng thái triển khai).
>
> Đăng ký ISV vẫn **có ích nhưng không bắt buộc**, để:
> - xin **TPN sandbox** test trước khi đụng vào máy thật của tiệm,
> - có kênh **hỗ trợ kỹ thuật** khi máy tiệm gặp sự cố,
> - lấy **IsvId** (Dejavoo dùng để gắn giao dịch với ISV — có thể liên quan chia doanh thu).
>
> Các mục 3 và 4 dưới đây vì vậy là **tuỳ chọn**, không phải điều kiện tiên quyết.

> Máy của tiệm: **Dejavoo P1** (nền Kozen P3), terminal Android để bàn, có
> **Ethernet + USB**, chạy nền tảng **iPOSpays** của Dejavoo.

---

## 1. Kết luận kỹ thuật (đã đọc tài liệu chính thức)

Dejavoo có sẵn **SPIn (Secure Payment Interface)** — công cụ tích hợp dành riêng cho ISV.

| Hạng mục | Kết quả |
|---|---|
| Kiểu kết nối | **REST API qua cloud** → khớp thẳng tầng **Cloud** của Lumio |
| Cần Bridge Windows không? | **KHÔNG** |
| Lệnh SPIn REST hỗ trợ | **Sale · Return · Void · Tip Adjust · Auth · Capture · Summary Report** |
| Dữ liệu thẻ | Không chạm server Lumio → **Dejavoo nói rõ: ISV nằm ngoài phạm vi PCI** |
| Kết nối | **Một URL duy nhất**, không cần IP riêng cho từng máy |
| Độ phủ | **Host platform agnostic** — đã chứng nhận EMV trên mọi nền xử lý lớn |
| Dự phòng | Có **SPIn USB fallback** (mất mạng tự chuyển USB) — làm sau nếu cần |

**Điểm đáng giá nhất:** *host platform agnostic*. Nghĩa là **một lần tích hợp SPIn**
dùng được cho **mọi tiệm có máy Dejavoo**, bất kể tiệm đó đang qua ISO/processor nào.

---

## 2. Điều anh cần quyết

Dejavoo yêu cầu **Lumio đăng ký làm ISV** để lấy SPIn API. Trái nguyên tắc "Lumio
không đăng ký gì", nhưng nhẹ hơn Clover rất nhiều:

| | Clover | Dejavoo |
|---|---|---|
| Publish app lên App Market | ✅ bắt buộc | ❌ không |
| Cài app lên từng máy | ✅ bắt buộc | ❌ không |
| Chỉ đăng ký ISV lấy API | — | ✅ chỉ vậy |
| Lumio mở tài khoản merchant / KYC tiền | không | **không** |
| Lumio giữ tiền | không | **không** |

---

## 3. BƯỚC 1 — Điền form đăng ký ISV

**Link đúng (dùng link này):**

```
https://dejavoo.io/resource-center/forms/spin-isv-form/
```

> ⚠️ Link cũ `dejavoosystems.com/spin-api-request-form` **đã chết**, đừng dùng.

Form chỉ có **7 ô**, điền như sau:

| Ô | Điền gì |
|---|---|
| **Name** (First / Last) | Tên anh |
| **Email** | Email công ty (nên dùng email theo tên miền, ví dụ `...@lumiobooking.com` — chuyên nghiệp hơn Gmail) |
| **Phone** | Số điện thoại liên hệ |
| **Company Name** | `Lumio Agency` (hoặc tên pháp nhân đăng ký) |
| **Website** | `https://lumiobooking.com` |
| **Sales Channel** | Chọn **`Both`** |
| **Approximate number of deals per month** | Ghi con số **thật**, ví dụ `5-10` |

**Vì sao chọn "Both":** anh vừa bán phần mềm **thẳng cho tiệm**, vừa có tiệm đến từ
**ISO** (như chiếc P1 này). Chọn *Both* giữ được cả hai đường, không phải xin lại sau.

**Vì sao đừng khai số ảo:** Dejavoo dùng con số này để xếp mức ưu tiên hỗ trợ. Khai
quá cao mà không có deal thật thì mất uy tín; khai thật kèm câu "hiện đã có 48 tiệm
đang chạy phần mềm" (ghi trong email bước 2) còn mạnh hơn nhiều.

---

## 4. BƯỚC 2 — Gửi email kỹ thuật (làm ngay sau khi nộp form)

Form trên chỉ là form sales. Gửi thêm email này để vào thẳng đội kỹ thuật:

**Tới:** `devsupport@dejavoo.io` — **CC:** `sales@dejavoo.io`
**Tiêu đề:** `SPIn REST API access request — Lumio Booking (ISV) — ISV form submitted`

> Hello Dejavoo team,
>
> I submitted the SPIn ISV form today. We are **Lumio Agency**, a booking + POS
> software provider for nail salons and spas in the **US and Canada**
> (**lumiobooking.com**). We currently have **48 salons** live on our platform.
>
> One of our merchants uses a **Dejavoo P1** terminal and we want to integrate it
> with our POS using **SPIn (REST API, cloud)**.
>
> Could you please provide:
> 1. **SPIn REST API credentials** for development
> 2. A **sandbox/test TPN** for integration testing
> 3. The **authentication scheme** — which header/field carries the auth key
> 4. Full **SPIn REST API documentation**
> 5. Whether a **certification / sign-off** step is required before going live
> 6. Whether **SPIn USB fallback** needs anything extra
>
> Our integration is server-side: our backend sends the payment request to the
> merchant's terminal and receives the result. No cardholder data is stored on our
> servers.
>
> Company: **Lumio Agency** · Website: **lumiobooking.com**
> Contact: **[tên anh]** — **[email]** — **[phone]**
>
> Thank you,
> **[tên anh]**

**Nếu 3–5 ngày không ai trả lời**, gọi trực tiếp:
- **Dejavoo USA:** 1-877-358-6797 (1-877-DJVOSYS)
- **Dejavoo Canada:** 647-430-0905 ← nhiều tiệm của anh ở Canada, gọi số này hợp hơn

---

## 5. BƯỚC 3 — Lấy thông tin máy của tiệm

1. Xin tiệm **TPN** (Terminal Profile Number) của chiếc P1 đó.
   Không có TPN thì liên hệ **ISO của tiệm** hoặc `support@dejavoo.io`.
2. Nhờ tiệm/ISO **bật chế độ semi-integrated (SPIn)** cho TPN đó.
   Nếu máy đang chạy app POS riêng của Dejavoo thì phải chuyển sang chế độ này.

---

## 6. BƯỚC 4 — Tiệm tự tạo token (đúng mô hình BYO)

Trong cổng **iPOSpays** của tiệm:

```
Settings → Generate Ecom/TOP Merchant Keys → chọn TPN → Generate Token
```

Token này tiệm sẽ **tự dán vào Lumio**, y hệt cách làm với Stripe/Helcim.
Lumio không giữ tài khoản, không giữ tiền.

---

## 7. BƯỚC 5 — Kiểm tra máy đã kết nối

Trên terminal, biểu tượng **mũi tên**:
- **Xanh** → TPN đã lên cổng, sẵn sàng.
- **Đỏ** → chưa kết nối. Kiểm tra dây Ethernet / WiFi của tiệm.

---

## 8. BƯỚC 6 — Gửi lại cho em

Khi có đủ, anh gửi em 4 thứ:

1. **Base URL** của SPIn REST API
2. **Cách xác thực** (tên header/field chứa auth key)
3. **TPN sandbox + token** để test
4. **Tài liệu REST API** đầy đủ (link hoặc file)

---

## 9. Sau đó em làm gì

- Viết **`DejavooConnector`** theo đúng khuôn Cloud như 6 provider hiện có
  (Sale → theo dõi trạng thái → Return/Void), map vào `PaymentConnector` interface.
- Đăng ký vào registry + hiện trong màn **Card terminals** để tiệm chọn.
- **Không đụng POS/Order** — thêm provider chỉ là thêm 1 connector.
- Nếu tiệm hay rớt mạng: bổ sung **SPIn USB fallback** qua Lumio Payment Bridge
  (đã xây xong và test E2E).

---

## 10. Link & liên hệ hữu ích

| Việc | Link |
|---|---|
| **Form đăng ký ISV** | https://dejavoo.io/resource-center/forms/spin-isv-form/ |
| Tài liệu SPIn | https://docs.ipospays.com/spin-specification |
| SPIn REST API | https://app.theneo.io/dejavoo/spin/spin-rest-api-methods |
| Brochure SPIn (PDF) | https://dejavoo.io/wp-content/uploads/2024/10/Dejavoo-One-pager-SPIn_v1-.pdf |
| Tài liệu giải pháp ISV (PDF) | https://dejavoo.io/wp-content/uploads/2024/11/SPIn_ISV-Solutions_v1_Final.pdf |
| Chứng nhận theo processor (US/CA) | https://dejavoo.io/resource-center/certifications/ |
| Trang trạng thái hệ thống | https://status.dejavoo.io |
| Dev support | devsupport@dejavoo.io |
| Sales | sales@dejavoo.io |

---

## 11. Ghi chú thật

- Em **chưa viết connector** vì tài liệu chi tiết tên trường request/response bị
  giới hạn truy cập — Dejavoo cấp sau khi duyệt ISV. Code theo phỏng đoán rồi anh
  test mới phát hiện sai thì mất thời gian hơn.
- **Bộ phương thức thì đã chắc chắn** (Sale/Return/Void/Tip Adjust/Auth/Capture/
  Summary), nên phần thiết kế connector không có rủi ro.
- Em có hỏi thêm trong email về **bước certification** — nhiều nhà xử lý bắt ISV
  chạy test sign-off trước khi lên live. Cần biết sớm để tính lịch.
