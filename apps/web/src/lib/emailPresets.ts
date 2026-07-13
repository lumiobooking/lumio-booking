// Ready-made campaigns. One click fills the composer; everything stays editable.
//
// The Body uses the tiny markup the email renderer understands:
//   ## Heading            → section title
//   - text                → green-tick bullet
//   [[PLAN]]  Name | Price | tagline | feat; feat; feat      → price card
//   [[PLAN*]] …           → the SAME card, highlighted
//   [[NOTE]] text         → soft grey note box
//   [[DIVIDER]]           → hairline
//   **bold**, URLs, phone numbers and emails are rendered automatically.
//
// WHY THE COPY READS THE WAY IT DOES — the audience is a Vietnamese salon owner in
// the US/Canada, and everything below is written for how they actually behave:
//   · They read email on a phone, standing, between two clients. The first two
//     lines have to do all the work.
//   · They have been burned by agencies promising "#1 on Google" and locking them
//     into contracts. So we promise less, out loud, and say what we will NOT do.
//   · Trust in this community travels by word of mouth and by feeling respected.
//     So we open with a proper greeting, we honour their craft, and we never talk
//     down to them about "digital marketing".
//   · They decide at night, after closing, often husband and wife together. So we
//     invite a text at 10pm, not a "discovery call".
//   · A cold email that names a price gets deleted. Price only appears in FORM 3,
//     which is for people who already replied.

export interface Preset {
  label: string;
  /** What this email is trying to achieve — shown in the picker. */
  goal: string;
  /** Who it should go to. Sending the right template to the wrong list is how
   *  campaigns end up in spam. */
  who: string;
  draft: {
    name: string; subject: string; fromName: string; preheader: string;
    heading: string; body: string; ctaLabel: string; ctaUrl: string; footerNote: string;
  };
}

const FOOTER = 'Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731 · (512) 886-8189 · support@lumioagency.com';
const AUDIT = 'https://lumioagency.com/#contact';

/** A real person, reachable three ways, at an hour that suits a salon owner. */
const SIGN_VN = `[[DIVIDER]]

Anh chị cứ nhắn thẳng cho em — kể cả 10 giờ đêm, khi tiệm đã đóng cửa. Em đọc hết.

- **Việt Nguyễn** — Lumio Agency LLC, Austin, Texas
- Gọi hoặc nhắn tin: (512) 886-8189
- Facebook: https://www.facebook.com/vietnguyen.lumio
- Email: support@lumioagency.com
- https://lumioagency.com  ·  https://lumiobooking.com

Trân trọng,
Việt Nguyễn
Lumio Agency`;

const SIGN_EN = `[[DIVIDER]]

Message me any time — even at 10pm after you close. I read every one.

- **Viet Nguyen** — Lumio Agency LLC, Austin, Texas
- Call or text: (512) 886-8189
- Facebook: https://www.facebook.com/vietnguyen.lumio
- Email: support@lumioagency.com
- https://lumioagency.com  ·  https://lumiobooking.com

Warm regards,
Viet Nguyen
Lumio Agency`;

export const LUMIO_PRESETS: Preset[] = [
  // ------------------------------------------------------------------ FORM 1
  // Cold. No price anywhere. One job: earn a reply. The hook is a scene the owner
  // has lived a hundred times — the empty chair nobody counted as a lost customer.
  {
    label: '🎯 FORM 1 · Chạm nỗi đau — kéo khách liên hệ (VN)',
    goal: 'Kéo khách trả lời email. Không nhắc giá — chỉ kể nỗi đau và tặng bản đánh giá miễn phí.',
    who: 'Danh sách LẠNH — tiệm chưa từng biết Lumio. Gửi tối thứ Ba/Tư, 8–10 giờ tối.',
    draft: {
      name: 'FORM 1 — Chạm nỗi đau (VN)',
      subject: 'Chiếc ghế trống tối thứ Sáu — không ai tính là mất khách',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Em xin phép hai phút của anh chị. Không bán gì cả — chỉ là một câu chuyện và một lời mời.',
      heading: 'Có những khách mình mất, mà không bao giờ biết là đã mất',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas. Em xin phép làm phiền anh chị đúng hai phút — rồi thôi.

Em kể anh chị nghe một chuyện.

Tối thứ Sáu, bảy giờ. Tiệm mình còn hai ghế trống. Cách tiệm ba con đường, có một người khách vừa tan làm, mở điện thoại lên gõ: **“nail salon near me”**.

Màn hình hiện ra ba cái tên. Không có tên tiệm mình.

Người khách đó bấm vào tiệm đầu tiên, đặt lịch, rồi cất điện thoại. Cô ấy **không hề biết là tiệm mình tồn tại**. Và tối đó, hai chiếc ghế trong tiệm mình vẫn trống.

Anh chị có bao giờ ngồi tính hai cái ghế đó không ạ?

Em đoán là không. Vì có ai gọi tới đâu mà biết. **Đó là loại khách mình mất mà không bao giờ biết là đã mất** — và nó lặp lại mỗi tối, âm thầm, suốt cả năm.

## Anh chị thử tự trả lời trong đầu, năm câu này

- Gõ “nail salon near me” trên điện thoại — tiệm mình đứng ở đâu?
- Bài đăng gần nhất trên Facebook hoặc TikTok của tiệm là **từ bao giờ**?
- Tuần rồi tiệm mình có **bao nhiêu cuộc gọi nhỡ** lúc đang đông khách?
- Mở website tiệm bằng điện thoại — mất mấy giây? Chữ có đọc nổi không?
- Tháng rồi khách **mới** đến từ đâu: Google, Facebook, hay đi ngang qua?

[[NOTE]] Nếu có **từ hai câu trở lên anh chị không trả lời được** — thì đó chính là chỗ tiền đang lặng lẽ đi ra khỏi cửa tiệm, mỗi tháng.

Em nói thẳng điều này: **tay nghề của anh chị không có vấn đề gì cả.** Khách ngồi xuống ghế rồi là anh chị giữ được họ. Vấn đề nằm ở đoạn **trước khi họ ngồi xuống** — đoạn mà anh chị đang bận cầm cây cọ, không ai lo giúp.

## Em xin làm giúp anh chị một bản đánh giá — không lấy tiền

Em không viết email này để bán gì hết. Em muốn gửi anh chị một thứ dùng được ngay:

- **Vị trí tiệm mình trên Google Maps**, theo đúng 5 câu mà khách hay gõ nhất
- **So sánh hồ sơ Google của tiệm với 3 tiệm gần nhất** — hơn thua chỗ nào, thấy bằng mắt
- **Chấm điểm website**: tốc độ, hiển thị trên điện thoại, kèm ảnh chụp màn hình
- **Ước lượng số khách có thể đang mất mỗi tháng** — em nói rõ cách tính, không bịa số
- **Ba việc nên làm trước tiên.** Anh chị **tự làm cũng được** — không cần thuê em

[[NOTE]] Bản đánh giá đó là **của anh chị**, giữ luôn. Xem xong thấy tự xử lý được thì cứ tự làm — em không gọi làm phiền, không nài nỉ một câu nào.

## Anh chị chỉ cần làm một việc rất nhỏ

Trả lời email này đúng **hai dòng**:

> **Tên tiệm** · **Link Google Maps** (hoặc số điện thoại tiệm)

Trong **48 tiếng** em gửi lại bản đánh giá. Không họp hành, không ai gọi điện làm phiền anh chị.

Hoặc tiện hơn thì anh chị nhắn thẳng cho em ở số bên dưới — em trả lời bằng tiếng Việt, và em trả lời nhanh.

${SIGN_VN}

P.S. Nếu anh chị chỉ tò mò muốn biết **tiệm mình đang đứng thứ mấy trên Google Maps** thôi, thì nhắn em **số điện thoại tiệm** là đủ. Em tra rồi nhắn lại cho anh chị **ngay trong hôm nay** — không cần cam kết gì hết.`,
      ctaLabel: 'Nhận bản đánh giá miễn phí →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ------------------------------------------------------------------ FORM 2
  // Trust first. For the owner who is not in pain today, or who has been burned by
  // an agency before. It sells nothing — it explains who we are, what we refuse to
  // do, and honours their craft. The ask is a conversation, not a purchase.
  {
    label: '🤝 FORM 2 · Thư đồng hương — xây niềm tin (VN)',
    goal: 'Xây niềm tin, xin một cuộc nói chuyện. Nói rõ 3 điều KHÔNG làm + 4 điều xin hứa.',
    who: 'Người KHÔNG trả lời Form 1 (gửi sau 7–10 ngày), hoặc tiệm từng bị agency khác làm mất niềm tin.',
    draft: {
      name: 'FORM 2 — Thư đồng hương (VN)',
      subject: 'Anh chị giỏi nghề. Chỉ là chưa ai lo giúp anh chị phần online',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Một lá thư, không phải một lời chào hàng. Bốn điều em xin hứa — và ba điều em từ chối làm.',
      heading: 'Thư gửi anh chị — người đã dựng nên cái tiệm bằng chính đôi tay mình',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas.

Lá thư này em viết không phải để bán hàng. Em viết vì có mấy điều muốn thưa với anh chị cho tử tế.

Em biết cái tiệm của anh chị **không phải tự nhiên mà có**. Nó là mười mấy tiếng đứng mỗi ngày. Là mùi hoá chất quen tới mức không còn ngửi thấy. Là những buổi tối về nhà, lưng mỏi rã, mà sáng hôm sau vẫn mở cửa đúng giờ. Là một chỗ đứng mà anh chị **giành lấy được** ở xứ người, chứ không ai cho.

Em nói thẳng: **tay nghề của anh chị không có gì phải bàn.** Khách đã ngồi xuống ghế của anh chị rồi là họ quay lại. Cái mà anh chị thiếu **không nằm trong cái tiệm** — nó nằm ở ngoài kia, chỗ mà khách chưa biết tới tiệm mình.

## Và em cũng biết vì sao anh chị ngại

Vì đã có người tới, hứa với anh chị **“lên top 1 Google”**. Rồi bắt ký hợp đồng. Rồi tự động trừ tiền thẻ mỗi tháng. Rồi im. Gọi không ai bắt máy. Hỏi thì trả lời bằng thứ tiếng Anh đầy chữ khó hiểu.

Sau lần đó, nghe tới hai chữ **“marketing”** là anh chị mệt. Em hiểu. Và em **không trách anh chị một chút nào.**

## Nên em xin nói trước — ba điều em KHÔNG làm

- Em **không hứa “top 1 Google”**. Ai hứa với anh chị điều đó là người đó không thành thật. Không ai kiểm soát được Google
- Em **không giữ tài khoản của anh chị**. Google, Facebook, website — tất cả đứng tên anh chị. Ngày nào anh chị ngưng, anh chị **mang đi hết**, em không giữ lại một thứ gì
- Em **không trói anh chị vào hợp đồng dài**. Em xin tối thiểu ba tháng, chỉ vì công việc cần từng đó thời gian mới thấy kết quả — chứ không phải để giữ chân anh chị

## Điều mà không một đơn vị marketing nào làm được cho anh chị

Em nói thẳng để anh chị so sánh.

Agency khác chạy quảng cáo, đăng bài, rồi **hết việc**. Khách thấy quảng cáo, gọi vào tiệm lúc bảy giờ tối — không ai bắt máy. Khách bỏ đi. **Agency đó không biết, và cũng không quan tâm** — vì phần đó không phải việc của họ.

Lumio khác ở đúng một chỗ: **em tự viết phần mềm vận hành cái tiệm.**

- Em **không chỉ kéo khách tới cửa** — em lo luôn đoạn khách bước vào: đặt lịch online 24/7, **AI bắt máy** khi tiệm bận, bot trả lời Messenger lúc nửa đêm, xếp ghế, chia lượt thợ, tính tiền, tính lương
- Vì phần mềm là **của em**, em **nối được quảng cáo với cái bill**. Cuối tháng em không khoe anh chị "lượt hiển thị" hay "lượt tương tác" — mấy con số đó không nuôi được ai. Em chỉ thẳng: **khách này đến từ Google Maps, đã chi $95**
- Em làm **từ trong tiệm ra ngoài đường**, không phải từ ngoài đường nhìn vào. Vì em đã ngồi nghĩ từng chi tiết nhỏ: ghế nào cho dịch vụ nào, thợ nào tới lượt, tip chia sao cho thợ khỏi cãi nhau, bill chờ khi quầy đông
- Phần mềm là của em nên **lỗi gì em sửa được ngay trong ngày**. Em không đi thuê phần mềm của người khác rồi bán lại cho anh chị

[[NOTE]] Nói gọn: agency khác **đổ nước vào một cái xô thủng**. Em vá cái xô trước, rồi mới đổ nước.

## Nỗi đau của anh chị — và em xử lý ở đâu

- **Điện thoại reo lúc tiệm đông, không ai bắt máy** → AI trả lời 24/7: chào khách, hỏi dịch vụ, xem giờ trống, **chốt lịch**, rồi nhắn tin xác nhận. Không mất khách vì bận nữa
- **Khách gõ “nail salon near me” mà không thấy tiệm mình** → Google Maps SEO chuyên sâu, tối ưu hồ sơ Google, chiến lược đánh giá
- **Facebook, TikTok bỏ trống cả tháng** → nội dung mới đều đặn ~2 ngày/lần, anh chị duyệt trước khi đăng
- **Khách nhắn Messenger lúc 11 giờ đêm** → bot trả lời trong 2 giây, chốt lịch luôn. Anh chị ngủ, tiệm vẫn nhận khách
- **Thợ cãi nhau chuyện chia khách** → hệ thống **tự chia lượt**, công khai, ai cũng thấy con số của mình
- **Cuối tháng không biết tiền quảng cáo đi đâu** → báo cáo nguồn khách chính xác: bao nhiêu khách từ Google, từ Facebook, từ hotline, và mỗi nguồn đẻ ra bao nhiêu tiền
- **Website cũ, khách mở trên điện thoại rồi thoát trong 3 giây** → website $150, chuẩn điện thoại, gắn sẵn nút đặt lịch

## Và bốn điều em xin hứa

- Anh chị **sở hữu 100% tài khoản** — Google, Facebook, website đều đứng tên anh chị. Ngừng hợp tác lúc nào cũng mang đi hết
- **Không hợp đồng dài hạn.** Em xin tối thiểu 3 tháng chỉ vì công việc cần từng đó thời gian mới có tác dụng — không phải để trói anh chị
- Em **không hứa “top 1 Google”**. Ai hứa điều đó là không thành thật. Em chỉ báo cáo số đã xác minh, kèm ảnh chụp màn hình nguồn
- **Anh chị gọi là gặp em** — không phải tổng đài, không phải nhân viên đọc kịch bản. Người Việt, nói tiếng Việt, hiểu nghề nail

[[NOTE]] Anh chị hỏi bất cứ chủ tiệm nào đang làm với Lumio — em sẵn sàng cho số để anh chị gọi hỏi thẳng họ, không cần qua em.

## Em xin anh chị một điều duy nhất

Không phải tiền. Là **một cuộc nói chuyện**.

Anh chị gọi cho em, hoặc nhắn cho em, lúc nào cũng được — **kể cả mười giờ đêm khi tiệm đã đóng cửa**. Em nghe anh chị kể tiệm mình đang vướng ở đâu, rồi em nói thật anh chị nên làm gì trước, làm gì sau.

Nếu sau cuộc nói chuyện đó anh chị thấy **chưa cần tới Lumio** — em vẫn cảm ơn anh chị đã cho em thời gian, và em vẫn để lại cho anh chị vài việc để tự làm.

Em không mất gì cả. Còn anh chị thì có thêm một người biết nghề, nói cùng tiếng, để hỏi khi cần.

${SIGN_VN}

P.S. Anh chị đang bận thì cứ để email này đó. Khi nào tiệm vắng khách một buổi chiều nào đó, anh chị mở ra đọc lại — em vẫn ở đây.`,
      ctaLabel: 'Nói chuyện với em — không mất gì →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ------------------------------------------------------------------ FORM 3
  // The quote — but told as a journey, not a price list. Only send this to someone
  // who already replied. $45 first, so $179 and $279 look reasonable; the Pro card
  // is the highlighted one, because that is where the eye should land.
  {
    label: '📋 FORM 3 · Báo giá kể chuyện (VN)',
    goal: 'Chốt đơn. Bảng giá kể thành 3 chặng đường: $45 → $179 → $279 (+ website $150).',
    who: 'Khách ẤM — đã trả lời, đã nói chuyện, đã hỏi giá. Đừng gửi cho danh sách lạnh.',
    draft: {
      name: 'FORM 3 — Báo giá kể chuyện (VN)',
      subject: 'Ba chặng đường để tiệm mình được khách tìm thấy — em xin trình bày',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Anh chị đang ở chặng nào, em bắt đầu từ chặng đó. Chỉ từ $45/tháng. Không hợp đồng dài.',
      heading: 'Không ai đi hết con đường trong một bước',
      body: `Kính chào anh/chị,

Cảm ơn anh chị đã dành thời gian cho em.

Như em có thưa, em không bán cho anh chị **một gói dịch vụ**. Em muốn cùng anh chị đi **một chặng đường** — và anh chị đang đứng ở đâu, thì mình bắt đầu từ đó.

Em xin kể ba chặng, bằng đúng những gì em thấy ở các tiệm em từng làm.

## Chặng thứ nhất — cho tiệm “còn sống” trên mạng

Khách lạ mở Facebook của tiệm ra xem. Bài đăng gần nhất: **tháng Tư năm ngoái**. Họ đóng lại. Trong đầu họ, tiệm mình **đã dẹp rồi**.

Chặng này em không làm gì to tát. Em chỉ làm cho tiệm mình **sống lại** trên mạng — đều đặn, tử tế, để ai ghé qua cũng thấy đây là một tiệm đang hoạt động, có người chăm.

[[PLAN]] Lumio Social Care | $45/tháng | Chặng 1 — cho tiệm sống lại trên mạng | Đăng đều Facebook, Instagram, TikTok, Shorts, Yelp; Nội dung mới khoảng 2 ngày một lần; Theo mẫu của ngành, chỉnh riêng cho tiệm mình; Chưa gồm Google Maps SEO và báo cáo

[[NOTE]] $45 một tháng. Bằng đúng **một bộ móng**. Anh chị làm một bộ là đủ trả cho cả tháng.

## Chặng thứ hai — cho khách đặt được lịch, kể cả lúc mình đang bận

Khách gọi tới lúc bảy giờ tối, tiệm đông kín, sáu cái tay đang bận. Không ai bắt máy. Khách gọi tiệm khác. **Đó là tiền đi ra khỏi cửa, mà không ai nhìn thấy.**

Chặng này, ngoài social, em đưa vào tiệm mình **hệ thống LumioBooking** — khách tự đặt lịch trên điện thoại, hai mươi bốn trên bảy, kể cả lúc tiệm đóng cửa. Có AI trả lời điện thoại và Messenger giùm. Có POS tính tiền, có lương thợ, có báo cáo khách đến từ đâu.

[[PLAN]] Lumio Boost + LumioBooking | $179/tháng | Chặng 2 — nền tảng vững, khách đặt được lịch | Toàn bộ phần social ở chặng 1; Tối ưu hồ sơ Google Business Profile; Link in bio, duyệt nội dung trước khi đăng; **Trọn bộ phần mềm LumioBooking** — đặt lịch 24/7, AI nghe điện thoại, POS, quản lý thợ; Báo cáo tháng ngắn gọn, dễ hiểu

## Chặng thứ ba — cho khách **tìm là thấy**

Đây là chặng khó nhất, và cũng là chặng đáng tiền nhất.

Khách gõ “nail salon near me”. Trên màn hình điện thoại của họ chỉ có **ba cái tên**. Ai đứng trong ba cái tên đó, người ấy có khách. Còn lại, dù tay nghề giỏi tới đâu, cũng **không tồn tại** trong mắt người khách đó.

Chặng này em làm Google Maps SEO chuyên sâu, xây chiến lược đánh giá, và theo dõi từng lượt gọi, từng lượt bấm chỉ đường về tiệm — để anh chị **nhìn thấy** tiền mình bỏ ra đang đẻ ra cái gì.

[[PLAN*]] Lumio Growth (Pro) | $279/tháng | Chặng 3 — để khách tìm là thấy tiệm mình | **Bao gồm trọn vẹn chặng 2** (social + LumioBooking); Google Maps SEO chuyên sâu; Chiến lược đánh giá + tín hiệu local; Theo dõi lượt hiển thị, lượt gọi, lượt chỉ đường; Báo cáo minh bạch, kèm ảnh chụp màn hình nguồn

[[NOTE]] Em **không hứa “top 1 Google”** — ai hứa điều đó là không thành thật. Em hứa **làm đúng việc, làm đều, và báo cáo bằng số thật.**

[[DIVIDER]]

## Còn website — em xin để riêng ra, $150

Không tính theo tháng. **Một lần $150**, xong là của anh chị.

Website nhanh, đẹp, **chuẩn điện thoại** (chín trên mười khách xem bằng điện thoại), song ngữ Việt – Anh, gắn sẵn nút Đặt lịch nối thẳng vào LumioBooking. **Tên miền và website đứng tên anh chị.**

[[DIVIDER]]

## Vì sao trả tiền cho Lumio chứ không phải agency khác

Agency khác chạy quảng cáo xong là **hết việc**. Khách thấy quảng cáo, gọi vào tiệm lúc bảy giờ tối, không ai bắt máy — khách bỏ đi. Họ không biết, và cũng không quan tâm.

Lumio khác đúng một chỗ: **em tự viết phần mềm vận hành cái tiệm.**

- Em không chỉ kéo khách tới cửa — em lo luôn đoạn khách bước vào: **AI bắt máy**, bot trả lời Messenger, xếp ghế, chia lượt thợ, tính tiền, tính lương
- Vì phần mềm là **của em**, em **nối được đồng quảng cáo với cái bill**: cuối tháng em không khoe “lượt hiển thị”, em chỉ thẳng **khách này đến từ Google Maps và đã chi $95**
- Em nghĩ từng chi tiết **từ trong tiệm ra ngoài đường** — ghế nào cho dịch vụ nào, thợ nào tới lượt, tip chia sao cho thợ khỏi cãi nhau. Vì em làm phần mềm cho tiệm nail, không phải cho tiệm cắt tóc bên Mỹ
- Lỗi gì em **sửa được ngay trong ngày** — em không thuê phần mềm của người khác rồi bán lại cho anh chị

[[NOTE]] Agency khác đổ nước vào một cái xô thủng. **Em vá cái xô trước, rồi mới đổ nước.**

## Anh chị không cần chọn hôm nay

Anh chị đọc xong, thấy mình đang ở chặng nào thì nhắn em chặng đó. Hoặc gọi cho em, mình nói chuyện mười phút, em nói thật anh chị nên bắt đầu từ đâu — **có khi em khuyên anh chị chưa cần chi đồng nào cả**, nếu em thấy vậy là đúng.

Em cảm ơn anh chị đã đọc tới đây. Với em, đó đã là một sự tôn trọng lớn rồi.

${SIGN_VN}`,
      ctaLabel: 'Gọi cho em — mình bàn 10 phút →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ---------------------------------------------------------------- EN + phụ
  {
    label: '🇺🇸 EN · Free audit (kéo khách liên hệ)',
    goal: 'Same as Form 1, in English — get a reply, give away a free audit.',
    who: 'Cold list — owners who don’t read Vietnamese.',
    draft: {
      name: 'EN — Free audit',
      subject: 'Someone just searched “nail salon near me” — did you show up?',
      fromName: 'Viet Nguyen · Lumio Agency',
      preheader: 'I’ll check it for you, free. Nothing to buy — just send me your salon name.',
      heading: 'You may be losing customers without ever knowing it',
      body: `Dear {{name}},

My name is **Viet Nguyen**, from **Lumio Agency** in Austin, Texas. Two minutes of your time, that's all I ask.

Friday night, 7pm. Someone is standing three blocks from your salon. They pull out their phone and type **“nail salon near me.”**

Did your shop come up?

If it didn't, that customer **doesn't know you exist**. They tapped the first salon on the list. And the empty chair in your shop that night — **nobody counted it as a lost customer**, because nobody ever called.

## Try answering these five questions

- Type “nail salon near me” on your phone — where does your salon land?
- When was the **last post** on your Facebook or TikTok?
- How many **missed calls** did you have last week?
- Open your website on a phone — how many seconds? Can you even read it?
- Where did last month's new customers come from — Google, Facebook, or walking past?

[[NOTE]] If you couldn't answer **two or more** of those, that is exactly where money is quietly leaking out of your business every month.

## Let me put together a free audit for you

I'm not emailing to sell you anything. I want to hand you something you can use today:

- **Where you rank on Google Maps** for the 5 searches your customers actually use
- **Your Google profile vs. the 3 salons nearest you** — where you win, where you lose
- **A website health score**: speed and mobile display, with screenshots
- **An estimate of the customers you may be losing each month** — with the maths shown
- **The 3 things to fix first.** You can **do them yourself** — you don't need to hire me

[[NOTE]] The audit is **yours to keep**. If you read it and decide you can handle it in-house, go right ahead — I won't chase you.

## Why free?

Straight answer: because when you see that I do honest work and tell you the truth, you'll remember me the day you need someone. That's the whole plan. And because I do these by hand, **I only take 5 salons a week**.

## All you have to do

Reply with **two lines**: **Salon name** · **Google Maps link** (or your phone number). Within **48 hours** the audit is in your inbox. No meeting, no sales call.

${SIGN_EN}

P.S. Only curious where you rank right now? Just send your salon's phone number — I'll look it up and text you back **today**, no commitment.`,
      ctaLabel: 'Get my free audit →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
  {
    label: '🖥️ Phụ · Website $150 (VN)',
    goal: 'Chào riêng dịch vụ website. Món dễ chốt nhất: trả một lần, số tiền nhỏ, thấy kết quả ngay.',
    who: 'Tiệm có website cũ/chậm, hoặc chưa có website.',
    draft: {
      name: 'Website $150 — VN',
      subject: 'Website riêng cho tiệm — $150, trả một lần, anh chị sở hữu luôn',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Nhanh, chuẩn điện thoại, song ngữ Việt – Anh, gắn sẵn nút đặt lịch. Không phí ẩn.',
      heading: 'Tiệm mình xứng đáng có một website tử tế',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas.

Em kể anh chị nghe chuyện xảy ra mỗi ngày: khách lạ tìm thấy tiệm mình trên Google, tò mò bấm vào website — rồi thấy một trang cũ, chậm, mở trên điện thoại chữ bé xíu. Ba giây sau họ thoát ra, bấm vào tiệm kế bên.

Cái website đó **không lấy tiền của anh chị**. Nó chỉ lặng lẽ **đẩy khách sang tiệm khác** thôi.

[[PLAN*]] Website trọn gói | $150 | Trả một lần, không phí ẩn | Nhanh, đẹp, **chuẩn điện thoại** — chín trên mười khách xem bằng điện thoại; Song ngữ Việt – Anh; Gắn sẵn nút Đặt lịch nối thẳng LumioBooking; Chuẩn Google: tên tiệm, địa chỉ, giờ mở cửa, bản đồ, đánh giá; **Website và tên miền đứng tên anh chị**

[[NOTE]] $150 trả một lần. Anh chị chỉ trả thêm phí tên miền và hosting **theo giá gốc** — em không ăn chênh lệch một đồng nào.

## Em xin làm thế này

Anh chị nhắn cho em **tên tiệm và link Google Maps**. Trong 48 tiếng em gửi lại **bản phác thảo website của tiệm mình** — anh chị nhìn tận mắt rồi hãy quyết.

Không ưng thì thôi ạ, em không làm phiền anh chị nữa.

${SIGN_VN}`,
      ctaLabel: 'Xem bản demo website của tiệm →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
];

/** A salon → its own customers. One template per real reason to email. */
export const SALON_PRESETS: Preset[] = [
  {
    label: '🎁 Ưu đãi cho khách quen',
    goal: 'Kéo khách quay lại bằng một ưu đãi nhỏ.',
    who: 'Khách đã từng tới tiệm.',
    draft: {
      name: 'Ưu đãi khách quen',
      subject: 'Cảm ơn {{name}} — tiệm tặng chị 20% cho lần tới',
      fromName: '',
      preheader: 'Ưu đãi riêng cho khách quen. Đặt lịch online chỉ mất chưa tới một phút.',
      heading: 'Cảm ơn {{name}} đã tin tưởng tiệm',
      body: `Chào {{name}},

Cảm ơn chị đã ghé tiệm. Để cảm ơn khách quen, tiệm xin gửi chị một ưu đãi nhỏ:

- **Giảm 20%** cho lần hẹn tiếp theo
- Áp dụng cho tất cả dịch vụ
- Đặt lịch online, chọn đúng người thợ chị quen

Chỉ cần bấm nút bên dưới, chọn ngày giờ — xong trong chưa tới một phút.

Hẹn gặp lại chị!`,
      ctaLabel: 'Đặt lịch ngay →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '💔 Khách lâu chưa quay lại',
    goal: 'Gọi khách cũ trở lại. Nhẹ nhàng, không trách móc, có lý do để quay lại.',
    who: 'Khách 2–6 tháng chưa tới. Đây là nhóm dễ kéo về nhất, rẻ hơn tìm khách mới rất nhiều.',
    draft: {
      name: 'Khách lâu chưa quay lại',
      subject: '{{name}} ơi, lâu rồi tiệm không gặp chị',
      fromName: '',
      preheader: 'Tiệm vẫn giữ ghế cho chị. Lần này tiệm tặng chị một ưu đãi nhỏ.',
      heading: 'Lâu rồi tiệm không gặp {{name}}',
      body: `Chào {{name}},

Tiệm coi lại sổ, thấy đã lâu chị chưa ghé. Tiệm nhớ chị đó ạ.

Không biết dạo này chị bận, hay có điều gì lần trước tiệm làm chưa vừa ý chị? Nếu có, chị cứ nói thẳng với tiệm — tiệm nghe và sửa, thật lòng.

Còn nếu chỉ vì chị bận quá, thì tiệm xin gửi chị một lý do để ghé lại:

- **Giảm 25%** cho lần hẹn tới — riêng cho chị
- Chị chọn đúng người thợ quen như mọi khi
- Đặt lịch online, không phải gọi điện chờ máy

Ghế của chị vẫn ở đó.`,
      ctaLabel: 'Đặt lịch — giữ ưu đãi 25% →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '✨ Giới thiệu dịch vụ mới',
    goal: 'Bán thêm dịch vụ mới cho khách sẵn có — nhóm dễ bán nhất.',
    who: 'Toàn bộ khách hàng của tiệm.',
    draft: {
      name: 'Dịch vụ mới',
      subject: 'Tiệm vừa có dịch vụ mới — mời {{name}} thử trước',
      fromName: '',
      preheader: 'Khách quen được thử trước, và được ưu đãi trong tuần đầu.',
      heading: 'Tiệm có dịch vụ mới — mời {{name}} thử trước',
      body: `Chào {{name}},

Tiệm vừa nhận thêm một dịch vụ mới, và tiệm muốn khách quen như chị là người thử trước.

## [Tên dịch vụ mới]

- [Điểm hay thứ nhất — viết ngắn]
- [Điểm hay thứ hai]
- [Thời gian làm khoảng ... phút]

**Tuần đầu tiên**, tiệm dành riêng cho khách quen mức giá giới thiệu. Chị đặt lịch sớm để chọn được giờ đẹp nhé.`,
      ctaLabel: 'Đặt lịch thử dịch vụ mới →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '🎉 Khuyến mãi dịp lễ',
    goal: 'Lấp kín lịch trong tuần cao điểm trước lễ.',
    who: 'Toàn bộ khách hàng. Gửi trước lễ 10–14 ngày.',
    draft: {
      name: 'Khuyến mãi dịp lễ',
      subject: 'Tuần lễ sắp tới tiệm kín lịch nhanh lắm — {{name}} giữ chỗ trước nhé',
      fromName: '',
      preheader: 'Giờ đẹp hết rất nhanh trong tuần lễ. Đặt trước cho chắc.',
      heading: '{{name}} ơi, giữ chỗ trước tuần lễ nhé',
      body: `Chào {{name}},

Năm nào cũng vậy — tuần trước lễ là tiệm kín lịch. Khách gọi tới thì chỉ còn những giờ không ai muốn.

Nên tiệm nhắn chị trước, để chị chọn giờ đẹp:

- Đặt lịch trước ngày [__], tiệm giảm **[__]%**
- Chọn đúng người thợ chị quen
- Tiệm sẽ nhắn nhắc chị trước ngày hẹn

Chị bấm nút bên dưới, chọn giờ mình thích — chưa tới một phút.`,
      ctaLabel: 'Giữ chỗ ngay →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '🤝 Nhờ khách giới thiệu bạn bè',
    goal: 'Lấy khách mới bằng khách cũ — nguồn khách rẻ nhất và trung thành nhất.',
    who: 'Khách quen, khách hài lòng, khách đã đánh giá 5 sao.',
    draft: {
      name: 'Giới thiệu bạn bè',
      subject: '{{name}} giới thiệu bạn — cả hai cùng được ưu đãi',
      fromName: '',
      preheader: 'Chị được giảm, bạn của chị cũng được giảm. Cảm ơn chị đã tin tiệm.',
      heading: 'Cảm ơn {{name}} — tiệm xin gửi chị lời cảm ơn thật',
      body: `Chào {{name}},

Tiệm sống được tới hôm nay là nhờ những khách như chị — tới đều, và nói tốt cho tiệm với bạn bè.

Nên tiệm muốn cảm ơn chị cho đàng hoàng:

- Chị giới thiệu một người bạn → **bạn của chị được giảm [__]%** cho lần đầu
- Và **chị cũng được giảm [__]%** cho lần hẹn kế tiếp
- Không giới hạn số người chị giới thiệu

Chị chỉ cần bảo bạn nhắc tên chị khi tới tiệm là được.

Cảm ơn chị nhiều ạ.`,
      ctaLabel: 'Gửi lịch đặt cho bạn bè →',
      ctaUrl: '',
      footerNote: '',
    },
  },
];
