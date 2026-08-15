# Facts cần dán vào bot bán hàng — bảng giá phần mềm

**Vì sao cần dán tay:** giá là dữ liệu của tiệm, không phải của code. Bot chỉ được nói những con số có trong **🏢 Thông tin doanh nghiệp** ở dashboard. Hiện phần đó **chỉ có các gói marketing**, nên khi khách hỏi giá AI Messenger, bot không có lựa chọn nào khác ngoài việc nói $179 — con số đúng với thứ nó biết, và sai với thứ khách hỏi.

## Đường đi chính xác trong dashboard

Trong giao diện **không có chỗ nào tên là "Facts"** — tôi ghi sai ở bản trước. Tên hiển thị thật là:

> **Messenger** (menu trái) → thẻ **🏢 Thông tin doanh nghiệp** → bấm **Mở rộng ▸**

Bên trong là danh sách từng dòng, mỗi dòng có: **ô tick bật/tắt** · **tên mục** · **nội dung**.

Các dòng có sẵn (Chỗ đậu xe, Ngôn ngữ nhân viên, Chuyên môn…) không sửa tên được. Muốn thêm dòng mới thì bấm nút **+ Thêm mục** ở dưới cùng — dòng mới cho phép **tự gõ tên mục**, đó là loại dòng bạn cần.

Xong hết thì bấm **Lưu thông tin**. Chưa bấm nút này là chưa lưu.

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

## Câu "không bán riêng" đến từ ĐÂU — đã xác định

Không có dòng nào như vậy trong 🏢 Thông tin doanh nghiệp. Chủ tiệm kiểm rồi, không thấy. **Câu đó đến từ code, không phải từ dữ liệu của bạn.**

Bản đang chạy trên server có một dòng viết cứng trong lời nhắc:

> *the Booking + AI + POS system free BY TIER (full system free from Growth Map $279 up; Boost $179 includes the free Booking system…)*

Dịch ra đúng nghĩa: *"hệ thống Booking + AI + POS được tặng theo từng mức gói; từ Boost $179 trở lên là có"*. Bot đọc câu này rồi diễn đạt lại thành *"không có giá riêng, kèm miễn phí từ gói Boost $179 trở lên"* — **đúng y hệt câu trong ảnh chụp màn hình**. Không phải bot bịa; nó lặp lại đúng thứ được dạy.

Dòng này đã bị **xoá hoàn toàn** trong commit `03d79fe`. Chừng nào chưa deploy thì server vẫn đọc bản cũ và vẫn trả lời như vậy.

**Nên thứ tự đúng là:**

1. **Deploy trước** (`Deploy update`) — bỏ câu sai khỏi lời nhắc
2. Rồi mới thêm 4 dòng bên dưới vào 🏢 Thông tin doanh nghiệp — để bot có con số $69 mà nói

Làm ngược lại cũng không sao, nhưng thiếu bước 1 thì bot vẫn nói *"không bán riêng"*, còn thiếu bước 2 thì bot chỉ biết trả lời *"để em hỏi team rồi báo lại"* — vì nó không được phép nói con số không có trong dữ liệu.

## Còn một chỗ nữa nên kiểm

Ngay dưới danh sách thông tin có ô **"Ghi chú thêm cho bot (tự do)"**. Đây là ô chữ tự do, cũng được đưa vào phần FACTS. Đọc lại xem trong đó có câu nào nói về giá hoặc về việc tặng kèm không — nếu có thì sửa luôn.

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

---

## Bot tự từ chối khách khác ngành — đã sửa trong code

Bot trả lời một chủ quán net/billiard/karaoke rằng *"bên em chuyên nail, spa và nhà hàng thôi ạ — chưa có dịch vụ riêng cho quán net/billiard/karaoke"*, rồi chúc may mắn và đóng hội thoại. Đó là mất khách, và mất một cách lịch sự nên sẽ không ai biết.

**Nguồn:** ô **Giới thiệu doanh nghiệp** trong Messenger. Nếu câu đó liệt kê ngành (*"…cho salon, spa, nhà hàng"*), bot đọc thành **danh sách đóng** và tự suy ra ngành nào không có trong đó là không phục vụ.

Đã sửa hai chỗ:

1. **Trong code** — thêm quy tắc đứng trên mọi quy tắc khác: bot **không được quyền quyết định ai là khách**. Ngành nghề nêu ở bất cứ đâu chỉ là **ví dụ, không phải giới hạn**. Không biết về ngành của khách là lý do để **xin số**, không phải để đóng chuyện. Và không được chào tạm biệt khi khách chưa được ghi nhận.
2. **Gợi ý mẫu trong giao diện** đã bỏ phần liệt kê ngành, kèm dòng nhắc ngay dưới nhãn.

**Việc bạn cần làm:** vào **Messenger → ô Giới thiệu doanh nghiệp**, nếu câu hiện tại có liệt kê ngành thì sửa lại thành câu **không đóng khung**, ví dụ:

`agency marketing trọn gói cho mọi ngành — website, quảng cáo, chatbot AI, phần mềm đặt lịch`

Cũng nên rà lại 🏢 Thông tin doanh nghiệp xem có dòng nào liệt kê ngành theo kiểu giới hạn không.

---

## Deploy rồi vẫn sai — hai khả năng còn lại

Câu gắn cứng trong code đã bị xoá và đã lên server. Nếu bot vẫn nói *"không tính riêng giá… tặng kèm theo gói marketing từ $179"* thì chỉ còn hai nguồn:

### Khả năng 1 — bạn đang sửa NHẦM TENANT

Đây là khả năng cao nhất, và nó giải thích vì sao bạn không tìm thấy dòng nào.

**Lumio Agency** và **Lumio Salon** là **hai tenant riêng biệt**, mỗi bên có phần Messenger riêng, dữ liệu riêng, không thấy được của nhau. Bot bán hàng chạy trên tenant **Lumio Agency**. Nếu bạn đang đăng nhập vào tenant Lumio Salon rồi mở Messenger, bạn sẽ thấy một danh sách **hoàn toàn khác** — và tất nhiên là không có dòng nào về giá gói marketing.

**Cách kiểm trong 5 giây:** mở Messenger, nhìn tên Page đang kết nối ở thẻ đầu trang. Phải là Page **Lumio Agency**. Nếu là Page khác thì bạn đang ở nhầm tenant — đăng xuất và vào đúng tài khoản Lumio Agency.

### Khả năng 2 — câu đó nằm trong dữ liệu do IMPORT tự sinh

Trong Messenger có tính năng đọc website/fanpage rồi tự sinh ra các dòng thông tin. Nếu trước đây bạn đã dùng nó với trang lumioagency.com, các dòng sinh ra là **chữ của website chứ không phải chữ bạn gõ** — nên đọc lướt sẽ không thấy quen và rất dễ bỏ qua.

Đọc kỹ **toàn bộ** danh sách 🏢 Thông tin doanh nghiệp trên tenant Lumio Agency, kể cả các dòng trông vô hại, và cả ô **Ghi chú thêm cho bot (tự do)** ngay dưới.

### Trong lúc chờ: code đã chặn sẵn

Đã thêm một quy tắc **đứng trên cả dữ liệu**: bot **không được phép nói bất cứ thứ gì "không có giá riêng" / "không bán lẻ" / "chỉ có kèm gói lớn"** — kể cả khi một dòng dữ liệu viết đúng như vậy. Dòng đó được hiểu là *một cách mua*, không phải *cách duy nhất*.

Hỏi giá một tính năng mà dữ liệu không có con số → bot phải nói **team sẽ xác nhận và xin số điện thoại**, tuyệt đối không được lấp chỗ trống bằng câu "chỉ có trong gói lớn".

---

## Số điện thoại theo khu vực — DÁN NGAY, đây là dữ liệu không phải code

Một khách ở **Úc** nhắn *"mình liên hệ không được, tiệm mình ở Úc, bạn có số khác không"*, và bot đưa lại **đúng số Mỹ** `(512) 886-8189` mà họ vừa nói là gọi không được.

Bot chỉ biết **một số duy nhất** — số liên hệ của tenant. Nó không thể biết số Úc nếu không ai nói cho nó. Đây là dữ liệu, và chỗ của nó là **🏢 Thông tin doanh nghiệp**.

**Thêm dòng này:**

| Nhãn | Nội dung |
|---|---|
| `Số liên hệ theo khu vực` | `Khách ở Mỹ/Canada: gọi (512) 886-8189. Khách ở Úc: gọi +61 485 857 256. Luôn đưa số đúng theo nơi khách nói họ đang ở. Nếu khách nói gọi số nào không được, đừng đưa lại số đó.` |

Trong code đã thêm quy tắc: **nơi khách ở quyết định số nào được đưa**, và **cấm đưa lại số mà khách vừa nói là không gọi được** — đưa lại đúng số đó đọc lên như không nghe khách nói gì, và đó là số cuối cùng họ thử.

Muốn thêm thị trường khác sau này thì viết thêm vào chính dòng đó, không cần deploy.

---

## Câu trả lời "Bên bạn có gì đặc biệt" — đã sửa văn phong

Câu cũ dài, kể máy móc: *"khách thấy tiệm trên Maps → nhắn Messenger hoặc gọi → AI em trả lời trong vài giây và chốt lịch thẳng vào hệ thống 24/7, không cần nhân viên trực page…"*

Chủ tiệm không mua đường ống. Họ mua **thêm khách và bớt khách bỏ hẹn**.

Trong code đã đổi quy tắc: trả lời **hai dòng ngắn, nói kết quả trước, máy móc sau** — và cấm dùng chữ như *"chốt lịch thẳng vào hệ thống"*, *"không cần nhân viên trực page"*, *"POS"*. Nếu khách hỏi **làm thế nào** thì mới được giải thích.

Khung câu trả lời mới:

> **Dòng 1 — thế đối lập:** *"Đa số agency dừng ở đăng bài và chạy ads. Bên em xây cả hệ thống: kéo khách MỚI về, và giữ khách CŨ quay lại ạ."*
>
> **Dòng 2 — một bằng chứng cụ thể, chọn theo điều khách vừa nói:** *"Khách tìm thấy tiệm trên Google, nhắn tin là có người trả lời ngay, lịch tự vào máy — rồi tin nhắc hẹn và tin mời khách cũ quay lại cũng tự chạy ạ."*

**Nên dán thêm dòng này** để bot có sẵn cách nói của bạn thay vì tự nghĩ:

| Nhãn | Nội dung |
|---|---|
| `Điểm khác biệt` | `Đa số agency chỉ đăng bài và chạy quảng cáo rồi dừng ở đó. Lumio xây hệ thống tổng thể: kéo khách MỚI về tiệm (Google Maps, quảng cáo, website), và GIỮ khách cũ quay lại (nhắc hẹn tự động, mời khách lâu chưa ghé, chương trình giới thiệu bạn bè). Nói kết quả cho chủ tiệm — thêm khách, bớt khách quên hẹn — đừng kể kỹ thuật.` |
