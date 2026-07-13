// Ready-made campaigns. One click fills the composer; everything stays editable.
//
// The Body uses the tiny markup the email renderer understands:
//   ## Heading            → section title
//   - text                → green-tick bullet
//   [[PLAN]]  Name | Price | tagline | feat; feat; feat      → price card
//   [[PLAN*]] …           → the SAME card, highlighted
//   [[NOTE]] text         → soft grey note box
//   [[TABLE]] a | b | c   → table header, then [[ROW]] … for each row
//   [[DIVIDER]]           → hairline
//   **bold**, URLs, phone numbers and emails are rendered automatically.
//
// TONE — this is the part to protect when editing.
// The reader is a Vietnamese salon owner in the US/Canada, reading on a phone,
// standing, between two clients. So every line is written to sound like a younger
// person from the same community talking to them with respect, NOT like a salesman:
//   · Warm, gentle, unhurried. No pressure, no scare tactics, no blunt one-liners.
//   · We never say "em nói thẳng", "mình bàn 10 phút", "cái tiệm" — those read curt
//     or peer-level. It is always "anh chị", "em", "tiệm mình", "em xin phép".
//   · We honour their craft first, and we admit what we will NOT do, before we ask
//     for anything at all.
//   · Nothing is designed to frighten them. Where a real problem exists we describe
//     it softly, as something we can fix together — not as money burning.
//   · A cold email that names a price gets deleted. Price only appears in FORM 3 and
//     FORM 4, which are for people who already replied.

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

const FOOTER = 'Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731 · (512) 886-8189 · support@lumioagency.com · facebook.com/LumioAgency.us';
const AUDIT = 'https://lumioagency.com/#contact';

/** A real person, reachable three ways, at an hour that suits a salon owner. */
const SIGN_VN = `[[DIVIDER]]

Anh chị cứ nhắn cho em bất cứ lúc nào ạ — kể cả mười giờ đêm, khi tiệm đã đóng cửa. Em đọc hết, và em trả lời bằng tiếng Việt.

- **Việt Nguyễn** — Lumio Agency LLC, Austin, Texas
- Điện thoại (gọi hoặc nhắn tin đều được): (512) 886-8189
- Facebook cá nhân của em: https://www.facebook.com/vietnguyen.lumio
- Fanpage Lumio Agency: https://www.facebook.com/LumioAgency.us
- Email: support@lumioagency.com
- Website: https://lumioagency.com  ·  Phần mềm: https://lumiobooking.com

Chúc anh chị và tiệm mình luôn nhiều khách, nhiều sức khoẻ.

Trân trọng,
Việt Nguyễn
Lumio Agency`;

const SIGN_EN = `[[DIVIDER]]

Message me any time — even at 10pm, after you close. I read every one.

- **Viet Nguyen** — Lumio Agency LLC, Austin, Texas
- Phone (call or text): (512) 886-8189
- My Facebook: https://www.facebook.com/vietnguyen.lumio
- Lumio Agency page: https://www.facebook.com/LumioAgency.us
- Email: support@lumioagency.com
- Website: https://lumioagency.com  ·  Software: https://lumiobooking.com

Wishing you and your shop a busy, healthy season.

Warm regards,
Viet Nguyen
Lumio Agency`;

export const LUMIO_PRESETS: Preset[] = [
  // ------------------------------------------------------------------ FORM 1
  // Cold. No price anywhere. One job: earn a reply. The scene is told gently — the
  // quiet chair, not "money burning". Nothing here is meant to frighten the reader.
  {
    label: '🎯 FORM 1 · Chạm nỗi đau — kéo khách liên hệ (VN)',
    goal: 'Kéo khách trả lời email. Không nhắc giá — chỉ kể một câu chuyện quen thuộc và tặng bản đánh giá miễn phí.',
    who: 'Danh sách LẠNH — tiệm chưa từng biết Lumio. Gửi tối thứ Ba/Tư, 8–10 giờ tối.',
    draft: {
      name: 'FORM 1 — Chạm nỗi đau (VN)',
      subject: 'Chiếc ghế trống tối thứ Sáu — mình thường không để ý tới nó',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Em xin phép hai phút của anh chị. Em không bán gì cả — chỉ có một câu chuyện và một lời mời nhỏ.',
      heading: 'Có những người khách mình lỡ mất, mà mình không hề hay',
      body: `Thân gửi {{greet}},

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas. Em xin phép anh chị chừng hai phút thôi ạ.

Em kể anh chị nghe một chuyện nhỏ.

Tối thứ Sáu, bảy giờ. Tiệm mình còn hai ghế trống. Cách tiệm ba con đường, có một người khách vừa tan làm, mở điện thoại lên gõ: **“nail salon near me”**.

Màn hình hiện ra ba cái tên. Lần đó, chưa có tên tiệm mình.

Người khách ấy bấm vào tiệm đầu tiên, đặt lịch, rồi cất điện thoại. Cô ấy **chưa từng biết là tiệm mình có ở đó**. Và tối hôm ấy, hai chiếc ghế của tiệm mình vẫn để trống.

Chuyện này thường mình không để ý, vì có ai gọi tới đâu mà mình biết. Nó cứ diễn ra rất lặng lẽ, tối này qua tối khác.

## Anh chị thử tự trả lời trong đầu, năm câu này

- Gõ “nail salon near me” trên điện thoại — tiệm mình đang đứng ở đâu ạ?
- Bài đăng gần nhất trên Facebook hoặc TikTok của tiệm là **từ bao giờ**?
- Tuần rồi tiệm mình có **bao nhiêu cuộc gọi nhỡ** lúc đang đông khách?
- Mở website tiệm bằng điện thoại — mất mấy giây, chữ có dễ đọc không ạ?
- Tháng rồi khách **mới** đến từ đâu: Google, Facebook, hay đi ngang qua?

[[NOTE]] Nếu có **hai câu trở lên anh chị chưa trả lời được** thì cũng bình thường thôi ạ — đó chỉ là những chỗ tiệm mình chưa có ai lo giúp, và đều là chỗ sửa được.

Em xin nói rõ một điều: **tay nghề của anh chị không có gì phải bàn cả.** Khách đã ngồi xuống ghế rồi thì anh chị giữ được họ. Chỗ còn thiếu nằm ở **đoạn trước khi khách ngồi xuống** — cái đoạn mà anh chị đang bận cầm cây cọ, chưa ai đỡ giúp.

## Em xin làm giúp anh chị một bản đánh giá — không lấy tiền

Em viết lá thư này không phải để bán cho anh chị thứ gì. Em chỉ muốn gửi anh chị một thứ dùng được ngay:

- **Vị trí tiệm mình trên Google Maps**, theo 5 câu mà khách hay gõ nhất
- **So sánh hồ sơ Google của tiệm với 3 tiệm gần nhất** — hơn thua chỗ nào, nhìn là thấy
- **Chấm điểm website**: tốc độ, hiển thị trên điện thoại, có kèm ảnh chụp màn hình
- **Ước lượng số khách tiệm mình có thể đang lỡ mỗi tháng** — em ghi rõ cách tính, không bịa số
- **Ba việc nên làm trước tiên.** Anh chị **tự làm cũng được** ạ — không cần thuê em

[[NOTE]] Bản đánh giá đó là **của anh chị**, anh chị giữ luôn. Xem xong thấy tự xoay được thì cứ tự làm, em không gọi làm phiền anh chị đâu ạ.

## Anh chị chỉ cần làm một việc rất nhỏ

Anh chị trả lời email này đúng **hai dòng**:

> **Tên tiệm** · **Link Google Maps** (hoặc số điện thoại tiệm)

Trong **48 tiếng** em gửi lại bản đánh giá. Không họp hành gì cả, cũng không ai gọi điện làm phiền anh chị.

Hoặc tiện hơn thì anh chị nhắn thẳng cho em ở số bên dưới — em trả lời bằng tiếng Việt, và em trả lời nhanh ạ.

${SIGN_VN}

P.S. Nếu anh chị chỉ tò mò muốn biết **tiệm mình đang đứng thứ mấy trên Google Maps**, thì nhắn em **số điện thoại tiệm** là đủ ạ. Em tra rồi nhắn lại cho anh chị **ngay trong hôm nay** — anh chị không cần cam kết gì cả.`,
      ctaLabel: 'Nhận bản đánh giá miễn phí →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ------------------------------------------------------------------ FORM 2
  // Trust first. For the owner who is not in pain today, or who has been burned by an
  // agency before. It sells nothing — it honours their work, says what we refuse to
  // do, and asks only for a conversation.
  {
    label: '🤝 FORM 2 · Thư đồng hương — xây niềm tin (VN)',
    goal: 'Xây niềm tin, xin một cuộc nói chuyện. Nói rõ 3 điều KHÔNG làm + 4 điều xin hứa.',
    who: 'Người CHƯA trả lời Form 1 (gửi sau 7–10 ngày), hoặc tiệm từng bị agency khác làm mất niềm tin.',
    draft: {
      name: 'FORM 2 — Thư đồng hương (VN)',
      subject: 'Anh chị giỏi nghề — chỉ là phần online chưa có ai lo giúp',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Một lá thư, không phải một lời chào hàng. 4 điều Lumio xin hứa — và 3 điều bên em xin phép không làm.',
      heading: 'Thư gửi anh chị — người đã dựng nên tiệm mình bằng chính đôi tay',
      body: `Thân gửi {{greet}},

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas.

Lá thư này em viết không phải để chào hàng ạ. Em viết vì có vài điều em muốn được chia sẻ với anh chị cho trọn vẹn.

Em biết tiệm của anh chị **không phải tự nhiên mà có**. Đó là mười mấy tiếng đứng mỗi ngày. Là mùi hoá chất quen tới mức không còn ngửi thấy nữa. Là những buổi tối về nhà lưng mỏi rã rời, mà sáng hôm sau vẫn mở cửa đúng giờ. Là một chỗ đứng anh chị **tự tay gây dựng** ở xứ người.

Nên em xin nói thật lòng: **tay nghề của anh chị thì không có gì phải bàn.** Khách ngồi xuống ghế một lần là họ quay lại. Thứ còn thiếu **không nằm bên trong tiệm** — nó nằm ở ngoài kia, chỗ những người khách chưa từng biết tới tiệm mình.

## Em cũng hiểu vì sao anh chị ngại

Vì đã từng có người tới, hứa với anh chị **“lên top 1 Google”**. Rồi ký hợp đồng. Rồi mỗi tháng thẻ vẫn bị trừ tiền. Rồi im. Gọi thì không ai bắt máy, hỏi thì trả lời bằng những chữ tiếng Anh khó hiểu.

Sau lần đó, nghe tới hai chữ **“marketing”** là anh chị đã thấy mệt rồi. Em rất hiểu điều đó ạ.

## Nên em xin thưa trước — 3 điều Lumio xin phép KHÔNG làm

- Em **không hứa “top 1 Google”**. Không ai kiểm soát được Google, nên ai hứa điều đó là chưa thành thật với anh chị
- Em **không giữ tài khoản của anh chị**. Google, Facebook, website — tất cả đứng tên anh chị. Ngày nào anh chị ngưng, anh chị **mang đi hết**, em không giữ lại thứ gì
- Em **không trói anh chị vào hợp đồng dài**. Em xin tối thiểu ba tháng, chỉ vì công việc cần chừng đó thời gian mới thấy kết quả — chứ không phải để giữ chân anh chị

## Điều mà ít đơn vị làm được cho anh chị

Em xin phép nói rõ, để anh chị dễ so sánh ạ.

Nhiều nơi chạy quảng cáo, đăng bài, rồi **xong việc**. Khách thấy quảng cáo, gọi vào tiệm lúc bảy giờ tối — không ai bắt máy, khách bỏ đi. Bên đó thường **không biết chuyện ấy**, vì phần đó không thuộc phạm vi của họ.

Lumio khác ở đúng một chỗ: **phần mềm vận hành tiệm là do chính Lumio phát triển.**

- Lumio **không chỉ kéo khách tới cửa** — bên em lo luôn đoạn khách bước vào: đặt lịch online 24/7, **AI bắt máy** khi tiệm bận, bot trả lời Messenger lúc nửa đêm, xếp ghế, chia lượt thợ, tính tiền, tính lương
- Vì phần mềm là **của Lumio**, bên em **nối được quảng cáo với cái bill**. Cuối tháng em không khoe anh chị “lượt hiển thị” hay “lượt tương tác” — mấy con số đó khó mà giúp gì cho tiệm. Em chỉ rõ: **khách này đến từ Google Maps, đã chi $95**
- Lumio làm **từ trong tiệm ra ngoài đường**, chứ không phải từ ngoài nhìn vào. Bên em ngồi nghĩ từng chi tiết nhỏ: ghế nào cho dịch vụ nào, thợ nào tới lượt, tip chia sao cho anh em vui vẻ, bill chờ khi quầy đông
- Phần mềm là của Lumio nên **có trục trặc gì bên em xử lý được ngay trong ngày**. Lumio không đi thuê phần mềm của nơi khác rồi bán lại cho anh chị

[[NOTE]] Xin phép ví von cho dễ hình dung ạ: nhiều nơi **đổ nước vào một chiếc xô thủng**. Lumio xin vá cái xô lại trước, rồi mới đổ nước vào.

## Những chỗ tiệm hay vướng — và Lumio đỡ giúp anh chị ở đâu

- **Điện thoại reo lúc tiệm đông, chưa ai kịp bắt máy** → AI trả lời 24/7: chào khách, hỏi dịch vụ, xem giờ trống, **chốt lịch**, rồi nhắn tin xác nhận
- **Khách gõ “nail salon near me” mà chưa thấy tiệm mình** → Google Maps SEO chuyên sâu, tối ưu hồ sơ Google, chiến lược đánh giá
- **Facebook, TikTok để trống cả tháng** → nội dung mới đều đặn khoảng 2 ngày một lần, anh chị duyệt trước khi đăng
- **Khách nhắn Messenger lúc 11 giờ đêm** → bot trả lời trong 2 giây, chốt lịch luôn. Anh chị ngủ, tiệm vẫn nhận khách
- **Anh em thợ đôi khi tị nhau chuyện chia khách** → hệ thống **tự chia lượt**, công khai, ai cũng thấy con số của mình
- **Cuối tháng chưa rõ tiền quảng cáo đi về đâu** → báo cáo nguồn khách rõ ràng: bao nhiêu khách từ Google, từ Facebook, từ hotline, và mỗi nguồn mang về bao nhiêu tiền
- **Website cũ, khách mở trên điện thoại rồi thoát ngay** → website $150, chuẩn điện thoại, gắn sẵn nút đặt lịch

## Và 4 điều Lumio xin hứa với anh chị

- Anh chị **sở hữu 100% tài khoản** — Google, Facebook, website đều đứng tên anh chị. Ngưng hợp tác lúc nào cũng mang đi hết
- **Không hợp đồng dài hạn.** Em xin tối thiểu 3 tháng chỉ vì công việc cần chừng đó thời gian mới có tác dụng
- Em **không hứa “top 1 Google”** — em chỉ báo cáo số đã xác minh, kèm ảnh chụp màn hình nguồn
- **Anh chị gọi là gặp em** — không phải tổng đài, không phải nhân viên đọc kịch bản. Người Việt, nói tiếng Việt, hiểu nghề nail

[[NOTE]] Anh chị muốn hỏi thăm bất cứ chủ tiệm nào đang làm với Lumio, em xin gửi số để anh chị gọi hỏi trực tiếp, không cần qua em ạ.

## Em chỉ xin anh chị một điều

Không phải tiền ạ. Chỉ là **một cuộc nói chuyện**.

Anh chị gọi hoặc nhắn cho em lúc nào cũng được — **kể cả mười giờ đêm, khi tiệm đã đóng cửa**. Em xin được nghe tiệm mình đang vướng ở đâu, rồi em thưa lại với anh chị nên làm gì trước, làm gì sau.

Nếu sau đó anh chị thấy **chưa cần tới Lumio**, em vẫn cảm ơn anh chị đã dành thời gian, và em vẫn để lại vài việc để anh chị tự làm cho tiệm.

Về phần em thì không mất gì cả. Còn anh chị thì có thêm một người trong nghề, nói cùng thứ tiếng, để hỏi mỗi khi cần.

${SIGN_VN}

P.S. Anh chị đang bận thì cứ để lá thư này đó ạ. Hôm nào tiệm vắng khách một buổi chiều, anh chị mở ra đọc lại — em vẫn ở đây.`,
      ctaLabel: 'Liên hệ với em — miễn phí →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ------------------------------------------------------------------ FORM 3
  // The quote — told as a journey, not a price list. Warm-list only. $45 first, so
  // $179 and $279 land softly; the Pro card is highlighted, gently.
  {
    label: '📋 FORM 3 · Báo giá kể chuyện (VN)',
    goal: 'Chốt đơn. Bảng giá kể thành 3 chặng đường: $45 → $179 → $279 (+ website $150).',
    who: 'Khách ẤM — đã trả lời, đã nói chuyện, đã hỏi giá. Đừng gửi cho danh sách lạnh.',
    draft: {
      name: 'FORM 3 — Báo giá kể chuyện (VN)',
      subject: '3 chặng đường để khách tìm thấy tiệm mình — em xin trình bày',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Anh chị đang ở chặng nào, mình bắt đầu từ chặng đó ạ. Chỉ từ $45/tháng, không hợp đồng dài.',
      heading: 'Mình cứ đi từ từ, không ai đi hết con đường trong một bước',
      body: `Thân gửi {{greet}},

Cảm ơn anh chị đã dành thời gian cho em ạ.

Như em đã thưa, em không muốn bán cho anh chị **một gói dịch vụ**. Em mong được cùng anh chị đi **một chặng đường** — anh chị đang đứng ở đâu, thì mình bắt đầu từ đó.

Em xin kể 3 chặng, bằng đúng những gì em thấy ở các tiệm Lumio đang làm.

## Chặng thứ nhất — cho tiệm mình “sống lại” trên mạng

Khách lạ mở Facebook của tiệm ra xem. Bài đăng gần nhất là **tháng Tư năm ngoái**. Họ đóng lại, và trong đầu họ, tiệm mình **có khi đã nghỉ rồi**.

Chặng này em không làm gì to tát cả. Em chỉ làm cho trang của tiệm **sống lại** — đều đặn, tử tế, để ai ghé qua cũng thấy đây là một tiệm đang mở cửa, có người chăm.

[[PLAN]] Lumio Social Care | $45/tháng | Chặng 1 — cho tiệm sống lại trên mạng | Đăng đều Facebook, Instagram, TikTok, Shorts, Yelp; Nội dung mới khoảng 2 ngày một lần; Theo mẫu của ngành, chỉnh riêng cho tiệm mình; Chưa gồm Google Maps SEO và báo cáo

[[NOTE]] $45 một tháng, bằng đúng **một bộ móng** ạ. Anh chị làm một bộ là đủ cho cả tháng rồi.

## Chặng thứ hai — cho khách đặt được lịch, kể cả lúc mình đang bận

Khách gọi tới lúc bảy giờ tối, tiệm đông kín, sáu cái tay đang bận. Chưa ai kịp bắt máy, khách gọi tiệm khác. Vậy là mình lỡ mất một người khách, mà cũng không hay.

Chặng này, ngoài phần social, em đưa vào tiệm **hệ thống LumioBooking** — khách tự đặt lịch trên điện thoại, hai mươi bốn trên bảy, kể cả lúc tiệm đã đóng cửa. Có sơ đồ ghế, có POS tính tiền, có chia lượt thợ, có lương và tip, có báo cáo khách đến từ đâu.

[[PLAN]] Lumio Boost + LumioBooking | $179/tháng | Chặng 2 — nền tảng vững, khách tự đặt được lịch | Toàn bộ phần social ở chặng 1; Tối ưu hồ sơ Google Business Profile; Link in bio, duyệt nội dung trước khi đăng; **Phần mềm LumioBooking** — đặt lịch 24/7, sơ đồ ghế, POS, chia lượt thợ, lương và tip; Báo cáo tháng ngắn gọn, dễ hiểu

## Chặng thứ ba — cho khách **tìm là thấy**

Đây là chặng khó nhất, và cũng là chặng em quý nhất.

Khách gõ “nail salon near me”. Trên màn hình điện thoại của họ chỉ có **ba cái tên**. Ai nằm trong ba cái tên đó thì có khách. Còn lại, dù tay nghề giỏi tới đâu, người khách ấy cũng chưa có dịp biết tới mình.

Chặng này em làm Google Maps SEO chuyên sâu, xây chiến lược đánh giá, và theo dõi từng lượt gọi, từng lượt bấm chỉ đường về tiệm — để anh chị **nhìn thấy** đồng tiền mình bỏ ra đang mang về điều gì.

[[PLAN*]] Lumio Growth (Pro) | $279/tháng | Chặng 3 — khách tìm là thấy, gọi tới là có người nghe | **Bao gồm trọn vẹn chặng 2** (social + LumioBooking); **AI Hotline — nghe máy 24/7 khi tiệm bận, chốt lịch giùm** *(chỉ có ở gói này)*; **Bot Messenger AI trả lời khách lúc nửa đêm** *(chỉ có ở gói này)*; Google Maps SEO chuyên sâu; Chiến lược đánh giá + tín hiệu local; Theo dõi lượt hiển thị, lượt gọi, lượt chỉ đường; Báo cáo minh bạch, kèm ảnh chụp màn hình nguồn

[[NOTE]] Em **không hứa “top 1 Google”** ạ. Em chỉ xin hứa **làm đúng việc, làm đều tay, và báo cáo bằng số thật.**

[[DIVIDER]]

## Còn website, em xin để riêng ra — $150

Không tính theo tháng ạ. **Một lần $150**, xong là của anh chị.

Website nhanh, đẹp, **chuẩn điện thoại** (chín trên mười khách xem bằng điện thoại), song ngữ Việt – Anh, gắn sẵn nút Đặt lịch nối thẳng vào LumioBooking. **Tên miền và website đứng tên anh chị.**

[[DIVIDER]]

## Vì sao anh chị nên chọn Lumio

Nhiều nơi chạy quảng cáo xong là **xong việc**. Khách thấy quảng cáo, gọi vào tiệm lúc bảy giờ tối, chưa ai kịp bắt máy — khách bỏ đi, và bên đó cũng không hay.

Lumio khác ở đúng một chỗ: **phần mềm vận hành tiệm là do chính Lumio phát triển.**

- Lumio không chỉ kéo khách tới cửa — bên em lo luôn đoạn khách bước vào: **AI bắt máy**, bot trả lời Messenger, xếp ghế, chia lượt thợ, tính tiền, tính lương
- Vì phần mềm là **của Lumio**, bên em **nối được đồng quảng cáo với cái bill**: cuối tháng em không khoe “lượt hiển thị”, em chỉ rõ **khách này đến từ Google Maps và đã chi $95**
- Lumio nghĩ từng chi tiết **từ trong tiệm ra ngoài đường** — ghế nào cho dịch vụ nào, thợ nào tới lượt, tip chia sao cho anh em vui vẻ. Vì đây là phần mềm làm riêng cho tiệm nail, chứ không phải phần mềm chung chung
- Có trục trặc gì **bên em xử lý được ngay trong ngày** — Lumio không thuê phần mềm của nơi khác rồi bán lại cho anh chị

[[NOTE]] Nói ngắn gọn ạ: nhiều nơi đổ nước vào một cái xô thủng. **Lumio xin vá cái xô trước, rồi mới đổ nước.**

## Anh chị không cần quyết hôm nay đâu ạ

Anh chị đọc xong, thấy tiệm mình đang ở chặng nào thì nhắn em chặng đó. Hoặc anh chị gọi cho em, em xin được nghe tiệm mình đang vướng ở đâu rồi thưa lại nên bắt đầu từ đâu — **có khi em lại khuyên anh chị chưa cần chi đồng nào**, nếu em thấy như vậy là hợp lý hơn.

Em xin chân thành cảm ơn anh chị đã đọc tới đây. Với em, chừng ấy thời gian anh chị dành cho lá thư này đã là một sự trân trọng lớn rồi ạ.

${SIGN_VN}`,
      ctaLabel: 'Liên hệ với em để được tư vấn →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },

  // ------------------------------------------------------------------ FORM 4
  // The full pitch. This is the one that has to survive a side-by-side with the
  // agency down the road — so it carries the two tables the others don't: what each
  // plan gives, and what happens if you do it yourself / hire a normal agency / hire us.
  {
    label: '📊 FORM 4 · Bảng so sánh gói + so với đối thủ (VN)',
    goal: 'Nâng giá trị gói lên tối đa. Cho khách thấy trọn bộ dịch vụ, so sánh 3 gói với nhau, và so Lumio với “tự làm” và “agency thường”.',
    who: 'Khách ẤM — đã nói chuyện, đang phân vân chọn gói, hoặc đang so Lumio với một agency khác.',
    draft: {
      name: 'FORM 4 — So sánh gói + đối thủ (VN)',
      subject: 'Trọn bộ 3 gói của Lumio — anh chị xem thử gói nào hợp với tiệm mình',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: '3 gói, một bảng so sánh rõ ràng, và lý do Lumio khác với agency thường. Chỉ từ $45/tháng.',
      heading: 'Anh chị đang ở chặng nào, mình bắt đầu từ chặng đó',
      body: `Thân gửi {{greet}},

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas. Cảm ơn anh chị đã dành thời gian cho em ạ.

Anh chị hỏi em nên chọn gói nào. Em xin bày hết ra đây thật rõ ràng, để anh chị tự cân nhắc — em không giấu gì cả.

## 3 gói phần mềm + dịch vụ — và mỗi gói đỡ giúp anh chị chuyện gì

[[PLAN]] Lumio Social Care | $45/tháng | Cho tiệm “sống lại” trên mạng | **Đỡ giúp anh chị:** trang Facebook, TikTok để trống, khách vào xem tưởng tiệm đã nghỉ; Đăng đều FB, IG, TikTok, Shorts, Yelp — nội dung mới ~2 ngày/lần; Theo mẫu của ngành nail, chỉnh riêng cho tiệm mình; Anh chị duyệt trước khi đăng, không đăng bừa
[[PLAN]] Lumio Boost + LumioBooking | $179/tháng | Cho khách tự đặt được lịch, khỏi phải gọi điện | **Đỡ giúp anh chị:** khách muốn đặt lịch phải gọi, mà lúc tiệm đông thì chưa ai kịp bắt máy; Trọn phần social ở gói $45; Tối ưu hồ sơ Google Business Profile; **Phần mềm LumioBooking** — đặt lịch online 24/7, POS tính tiền, sơ đồ ghế, chia lượt thợ, tính lương và tip; Báo cáo tháng gọn gàng, dễ hiểu
[[PLAN*]] Lumio Growth (Pro) | $279/tháng | Khách **tìm là thấy** — và gọi tới là có người bắt máy | **Đỡ giúp anh chị:** khách gõ “nail salon near me” mà chưa thấy tiệm mình, và khách gọi lúc tiệm đông thì chưa ai nghe được — hai chỗ thiệt thòi lớn nhất, vì mình lỡ mất khách mà không hay; **Bao gồm trọn vẹn gói $179**; **AI Hotline — nghe máy 24/7, chốt lịch, nhắn tin xác nhận** (chỉ có ở gói này); **Bot Messenger AI — trả lời khách lúc nửa đêm** (chỉ có ở gói này); Google Maps SEO chuyên sâu; Chiến lược đánh giá + tín hiệu local; Theo dõi lượt hiển thị, lượt gọi, lượt chỉ đường; Báo cáo minh bạch, kèm ảnh chụp màn hình nguồn

[[NOTE]] Website riêng cho tiệm: **$150, trả một lần** — chuẩn điện thoại, song ngữ Việt – Anh, gắn sẵn nút Đặt lịch. Tên miền và website **đứng tên anh chị**.

## Bảng so sánh 3 gói

[[TABLE]] Anh chị nhận được gì | $45 | $179 | $279 Pro
[[ROW]] Đăng bài đều đặn FB · IG · TikTok · Yelp | ✓ | ✓ | ✓
[[ROW]] Nội dung chỉnh riêng cho tiệm, duyệt trước khi đăng | ✓ | ✓ | ✓
[[ROW]] Tối ưu hồ sơ Google Business Profile | ✕ | ✓ | ✓
[[ROW]] **Phần mềm LumioBooking** (đặt lịch 24/7) | ✕ | ✓ | ✓
[[ROW]] **AI Hotline — nghe máy 24/7 khi tiệm bận** | ✕ | ✕ | ✓
[[ROW]] **Bot Messenger AI** trả lời khách lúc nửa đêm | ✕ | ✕ | ✓
[[ROW]] POS tính tiền · chia lượt thợ · lương & tip | ✕ | ✓ | ✓
[[ROW]] Báo cáo khách đến từ nguồn nào | ✕ | ✓ | ✓
[[ROW]] **Google Maps SEO chuyên sâu** | ✕ | ✕ | ✓
[[ROW]] Chiến lược đánh giá + tín hiệu local | ✕ | ✕ | ✓
[[ROW]] Theo dõi lượt gọi · lượt chỉ đường | ✕ | ✕ | ✓
[[ROW]] Báo cáo kèm ảnh chụp màn hình nguồn | ✕ | ✕ | ✓

[[DIVIDER]]

## Trong gói đã có sẵn cả một HỆ THỐNG — không chỉ là dịch vụ marketing

Đây là chỗ khác biệt lớn nhất, em xin bày rõ từng thứ một. Mỗi dòng dưới đây là **một chuyện các tiệm hay gặp**, và **một hệ thống Lumio đã dựng sẵn để lo giúp anh chị**.

[[TABLE]] Chuyện tiệm hay gặp | Hệ thống Lumio đã có sẵn | Agency khác
[[ROW]] Điện thoại reo lúc tiệm đông, chưa ai kịp bắt máy | **AI Hotline** — nghe máy 24/7, hỏi dịch vụ, xem giờ trống, **chốt lịch**, nhắn tin xác nhận *(gói Pro $279)* | ✕
[[ROW]] Khách nhắn Messenger lúc 11 giờ đêm | **Bot Messenger AI** — trả lời trong 2 giây, chốt lịch luôn, đúng thứ tiếng khách nhắn *(gói Pro $279)* | ✕
[[ROW]] Khách phải gọi điện mới đặt được lịch | **Form đặt lịch nhúng thẳng vào website** — khách tự đặt trong 40 giây | ✕
[[ROW]] Khách hẹn rồi không tới, ghế trống giờ cao điểm | **Đặt cọc online** + **nhắc lịch tự động** qua SMS và email | ✕
[[ROW]] Lễ tân chưa nắm được ghế nào trống, thợ nào rảnh | **Sơ đồ ghế** — cả tiệm trên một màn hình, ai đang làm ghế nào, làm được mấy phút | ✕
[[ROW]] Anh em thợ đôi khi tị nhau chuyện chia khách | **Hệ thống tự chia lượt** — công khai, ai cũng thấy con số của mình | ✕
[[ROW]] Khách chuyển từ ghế pedi qua bàn mani, hai thợ chung một bill | **Bill chạy theo khách** — thợ thứ hai tự thêm dịch vụ, **mỗi thợ vẫn đủ lượt** | ✕
[[ROW]] Lễ tân lỡ quên tính một dịch vụ | **POS tự điền bill** từ những gì thợ đã làm — không gõ lại, không sót | ✕
[[ROW]] Cuối tuần ngồi cộng tay lương và tip tới khuya | **Tính lương & tip tự động**, có **mã QR nhận tip riêng** cho từng thợ | ✕
[[ROW]] Khách lâu không quay lại | **Điểm thưởng khách quen** + **chương trình khách giới thiệu khách** | ✕
[[ROW]] Đánh giá Google chưa ai trả lời | **AI soạn sẵn câu trả lời** cho từng đánh giá — anh chị đọc, bấm duyệt, 3 giây | ✕
[[ROW]] Khách huỷ, ghế trống chưa ai lấp | **Danh sách chờ tự động lấp chỗ** | ✕
[[ROW]] Hết hàng mà chưa hay | **Quản lý kho** — báo trước khi sắp hết | ✕
[[ROW]] **Chưa rõ tiền quảng cáo mang về được gì** | **Báo cáo nguồn khách** — mỗi lịch hẹn, mỗi cái bill đều gắn nguồn từ giây đầu tiên | ✕
[[ROW]] Chủ đi vắng, khó nắm tình hình tiệm | **App cho chủ và cho thợ** — xem tiệm từ điện thoại, thợ xem đúng khách của mình | ✕
[[ROW]] Có 2–3 tiệm, quản lý hơi rối | **Nhiều chi nhánh**, mỗi tiệm một kho dữ liệu riêng, chuyển qua lại một cú chạm | ✕

[[NOTE]] 16 hệ thống ở trên **đã chạy thật, đang có tiệm dùng mỗi ngày** — không phải kế hoạch, không phải “sắp có” ạ.

Gói **$179** đã có sẵn phần lớn trong số đó — anh chị **không phải trả thêm đồng nào** cho phần mềm. Riêng **AI Hotline** và **Bot Messenger AI** thì chỉ có ở gói **Pro $279**, vì hai thứ này tốn chi phí cuộc gọi và xử lý AI mỗi ngày ạ.

[[DIVIDER]]

## Nếu anh chị muốn so Lumio với chỗ khác

Em xin phép không nói gì tới ai cả. Em chỉ bày 3 lựa chọn ra cạnh nhau, anh chị nhìn rồi tự cân ạ.

[[TABLE]] | Tự làm | Agency thường | Lumio
[[ROW]] Có người đăng bài đều đặn | ✕ | ✓ | ✓
[[ROW]] Có người lo Google Maps | ✕ | ✓ | ✓
[[ROW]] **Có người bắt máy khi tiệm bận** | ✕ | ✕ | ✓
[[ROW]] **Khách đặt được lịch online 24/7** | ✕ | ✕ | ✓
[[ROW]] **Biết rõ khách đến từ nguồn nào** | ✕ | ✕ | ✓
[[ROW]] **Nối được đồng quảng cáo với cái bill** | ✕ | ✕ | ✓
[[ROW]] Phần mềm quản lý tiệm đi kèm | ✕ | ✕ | ✓
[[ROW]] Nói tiếng Việt, gọi là gặp người thật | ✕ | — | ✓
[[ROW]] Không hứa “top 1 Google” | — | ✕ | ✓
[[ROW]] Anh chị sở hữu 100% tài khoản | ✓ | — | ✓
[[ROW]] Không hợp đồng dài hạn | ✓ | ✕ | ✓

[[NOTE]] Xin phép ví von cho dễ hình dung ạ: nhiều nơi **đổ nước vào một chiếc xô thủng** — kéo khách tới cửa rồi thôi, khách gọi vào chưa ai bắt máy thì cũng không hay. Lumio **vá cái xô lại trước**, rồi mới đổ nước vào.

## Vì sao Lumio làm được chuyện đó

Vì **phần mềm vận hành tiệm là do chính Lumio phát triển.** Đa số các nơi khác đi thuê phần mềm của bên thứ ba, nên phần bên trong tiệm họ khó với tới được.

- Lumio **không chỉ kéo khách tới cửa**, bên em lo luôn đoạn khách bước vào: AI bắt máy, bot Messenger, xếp ghế, chia lượt thợ, tính tiền, tính lương
- Cuối tháng em **không khoe “lượt hiển thị”** — mấy con số đó khó giúp gì cho tiệm. Em chỉ rõ: **khách này đến từ Google Maps, đã chi $95**
- Lumio nghĩ từng chi tiết **từ trong tiệm ra ngoài đường** — vì đây là phần mềm làm riêng cho tiệm nail, chứ không phải phần mềm chung chung
- Có trục trặc gì **bên em xử lý được ngay trong ngày**

## Em xin chia sẻ thật lòng với anh chị

Anh chị chưa muốn đi xa thì **bắt đầu ở gói $45** cũng được ạ — cho trang tiệm sống lại trước đã. Khi nào thấy ổn, mình nâng lên sau. Em không giục, và cũng không có hợp đồng nào trói anh chị cả.

Còn nếu anh chị hỏi em nên chọn gói nào, thì em xin nghiêng về **gói $279**. Vì gói đó vừa lo được chỗ thiệt thòi lớn nhất — khách tìm mà chưa thấy tiệm mình — vừa có **trọn bộ 16 hệ thống ở trên** để giữ chân người khách ấy lại, sau khi họ đã tìm thấy anh chị.

Anh chị cứ gọi cho em, mình cùng xem tiệm mình đang hụt ở đâu rồi hãy quyết ạ.

${SIGN_VN}`,
      ctaLabel: 'Liên hệ với em để được tư vấn →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
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
      body: `Dear {{name|there}},

My name is **Viet Nguyen**, from **Lumio Agency** in Austin, Texas. Two minutes of your time, that's all I ask.

Friday night, 7pm. Someone is standing three blocks from your salon. They pull out their phone and type **“nail salon near me.”**

Did your shop come up?

If it didn't, that customer simply **doesn't know you exist** yet. They tapped the first salon on the list. And the quiet chair in your shop that night — nobody counted it, because nobody ever called.

## Try answering these five questions

- Type “nail salon near me” on your phone — where does your salon land?
- When was the **last post** on your Facebook or TikTok?
- How many **missed calls** did you have last week?
- Open your website on a phone — how many seconds? Is it easy to read?
- Where did last month's new customers come from — Google, Facebook, or walking past?

[[NOTE]] If two or more of those are hard to answer, that's perfectly normal — it simply means nobody has been looking after that side of the business yet. All of it is fixable.

## Let me put together a free audit for you

I'm not emailing to sell you anything. I'd just like to hand you something you can use today:

- **Where you rank on Google Maps** for the 5 searches your customers actually use
- **Your Google profile vs. the 3 salons nearest you** — where you win, where you lose
- **A website health score**: speed and mobile display, with screenshots
- **An estimate of the customers you may be missing each month** — with the maths shown
- **The 3 things to fix first.** You can **do them yourself** — you don't need to hire me

[[NOTE]] The audit is **yours to keep**. If you read it and decide you can handle it in-house, please do — I won't chase you.

## Why free?

The honest answer: when you see that I do careful work and tell you the truth, I hope you'll remember me on the day you actually need someone. That's the whole plan. And because I prepare each one by hand, **I only take 5 salons a week**.

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
      preheader: 'Nhanh, chuẩn điện thoại, song ngữ Việt – Anh, gắn sẵn nút đặt lịch. Không có phí ẩn.',
      heading: 'Tiệm mình xứng đáng có một website tử tế',
      body: `Thân gửi {{greet}},

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas.

Em kể anh chị nghe một chuyện nhỏ hay gặp: khách lạ tìm thấy tiệm mình trên Google, tò mò bấm vào website — rồi thấy một trang cũ, hơi chậm, mở trên điện thoại chữ bé xíu. Vài giây sau họ thoát ra, bấm sang tiệm bên cạnh.

Cái website đó **không lấy đồng nào của anh chị** cả. Nó chỉ lặng lẽ để khách đi sang chỗ khác thôi ạ.

[[PLAN*]] Website trọn gói | $150 | Trả một lần, không phí ẩn | Nhanh, đẹp, **chuẩn điện thoại** — chín trên mười khách xem bằng điện thoại; Song ngữ Việt – Anh; Gắn sẵn nút Đặt lịch nối thẳng LumioBooking; Chuẩn Google: tên tiệm, địa chỉ, giờ mở cửa, bản đồ, đánh giá; **Website và tên miền đứng tên anh chị**

[[NOTE]] $150 trả một lần ạ. Anh chị chỉ trả thêm phí tên miền và hosting **theo giá gốc** — em không lấy chênh lệch đồng nào.

## Em xin làm thế này

Anh chị nhắn cho em **tên tiệm và link Google Maps**. Trong 48 tiếng em gửi lại **bản phác thảo website của tiệm mình** — anh chị nhìn tận mắt rồi hãy quyết ạ.

Nếu chưa ưng thì cũng không sao cả, em xin phép không làm phiền anh chị nữa.

${SIGN_VN}`,
      ctaLabel: 'Xem bản demo website của tiệm →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
];

/** A salon → its own customers. Warm, unhurried, never pushy. */
export const SALON_PRESETS: Preset[] = [
  {
    label: '🎁 Ưu đãi cho khách quen',
    goal: 'Kéo khách quay lại bằng một ưu đãi nhỏ.',
    who: 'Khách đã từng tới tiệm.',
    draft: {
      name: 'Ưu đãi khách quen',
      subject: 'Cảm ơn {{name|quý khách}} — tiệm xin gửi chị 20% cho lần tới',
      fromName: '',
      preheader: 'Một chút quà nhỏ cho khách quen. Đặt lịch online chưa tới một phút ạ.',
      heading: 'Cảm ơn {{name|quý khách}} đã thương tiệm',
      body: `Chào {{name|quý khách}},

Cảm ơn chị đã ghé tiệm mình. Tiệm xin gửi chị một chút quà nhỏ, gọi là cảm ơn khách quen:

- **Giảm 20%** cho lần hẹn tiếp theo
- Áp dụng cho tất cả dịch vụ
- Đặt lịch online, chọn đúng người thợ chị quen

Chị chỉ cần bấm nút bên dưới, chọn ngày giờ — xong trong chưa tới một phút ạ.

Tiệm mong sớm được gặp lại chị!`,
      ctaLabel: 'Đặt lịch ngay →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '💔 Khách lâu chưa quay lại',
    goal: 'Gọi khách cũ trở lại. Nhẹ nhàng, không trách móc, có lý do để quay lại.',
    who: 'Khách 2–6 tháng chưa tới. Đây là nhóm dễ kéo về nhất, nhẹ hơn tìm khách mới rất nhiều.',
    draft: {
      name: 'Khách lâu chưa quay lại',
      subject: '{{name|quý khách}} ơi, lâu rồi tiệm chưa được gặp chị',
      fromName: '',
      preheader: 'Tiệm vẫn giữ ghế cho chị. Lần này tiệm xin gửi chị một ưu đãi nhỏ.',
      heading: 'Lâu rồi tiệm chưa được gặp {{name|quý khách}}',
      body: `Chào {{name|quý khách}},

Tiệm xem lại sổ, thấy đã lâu chưa được đón chị. Tiệm nhớ chị lắm ạ.

Chắc dạo này chị bận nhiều. Mà nếu có điều gì lần trước tiệm làm chưa vừa ý chị, chị cứ nói với tiệm một tiếng — tiệm xin lắng nghe và sửa, thật lòng ạ.

Còn nếu chỉ vì chị bận quá, thì tiệm xin gửi chị một lý do nho nhỏ để ghé lại:

- **Giảm 25%** cho lần hẹn tới — riêng cho chị
- Chị chọn đúng người thợ quen như mọi khi
- Đặt lịch online, không phải gọi điện chờ máy

Ghế của chị vẫn luôn ở đó ạ.`,
      ctaLabel: 'Đặt lịch — giữ ưu đãi 25% →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '✨ Giới thiệu dịch vụ mới',
    goal: 'Giới thiệu dịch vụ mới tới khách sẵn có — nhóm dễ mời nhất.',
    who: 'Toàn bộ khách hàng của tiệm.',
    draft: {
      name: 'Dịch vụ mới',
      subject: 'Tiệm vừa có dịch vụ mới — mời {{name|quý khách}} thử trước',
      fromName: '',
      preheader: 'Khách quen được thử trước, và có ưu đãi trong tuần đầu ạ.',
      heading: 'Tiệm có dịch vụ mới — mời {{name|quý khách}} thử trước',
      body: `Chào {{name|quý khách}},

Tiệm vừa nhận thêm một dịch vụ mới, và tiệm muốn khách quen như chị là người được thử trước.

## [Tên dịch vụ mới]

- [Điểm hay thứ nhất — viết ngắn]
- [Điểm hay thứ hai]
- [Thời gian làm khoảng ... phút]

**Tuần đầu tiên**, tiệm xin dành riêng cho khách quen mức giá giới thiệu. Chị đặt lịch sớm để chọn được giờ đẹp nhé ạ.`,
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
      subject: 'Tuần lễ sắp tới tiệm kín lịch nhanh lắm — {{name|quý khách}} giữ chỗ trước nhé',
      fromName: '',
      preheader: 'Giờ đẹp thường hết rất nhanh trong tuần lễ. Chị đặt trước cho thong thả ạ.',
      heading: '{{name|quý khách}} ơi, chị giữ chỗ trước tuần lễ nhé',
      body: `Chào {{name|quý khách}},

Năm nào cũng vậy ạ — tuần trước lễ là tiệm kín lịch, khách gọi tới thì chỉ còn những giờ không được đẹp.

Nên tiệm xin nhắn chị sớm, để chị chọn được giờ ưng ý:

- Đặt lịch trước ngày [__], tiệm xin giảm **[__]%**
- Chị chọn đúng người thợ quen
- Tiệm sẽ nhắn nhắc chị trước ngày hẹn

Chị bấm nút bên dưới, chọn giờ mình thích — chưa tới một phút ạ.`,
      ctaLabel: 'Giữ chỗ ngay →',
      ctaUrl: '',
      footerNote: '',
    },
  },
  {
    label: '🤝 Nhờ khách giới thiệu bạn bè',
    goal: 'Lấy khách mới bằng khách cũ — nguồn khách nhẹ nhàng và bền nhất.',
    who: 'Khách quen, khách hài lòng, khách đã đánh giá 5 sao.',
    draft: {
      name: 'Giới thiệu bạn bè',
      subject: '{{name|quý khách}} giới thiệu bạn — cả hai cùng có ưu đãi',
      fromName: '',
      preheader: 'Chị được giảm, bạn của chị cũng được giảm. Cảm ơn chị đã thương tiệm.',
      heading: 'Cảm ơn {{name|quý khách}} — tiệm xin gửi chị lời cảm ơn thật lòng',
      body: `Chào {{name|quý khách}},

Tiệm đi được tới hôm nay là nhờ những khách như chị — ghé đều, và thương tiệm nên nói tốt với bạn bè.

Nên tiệm xin cảm ơn chị cho đàng hoàng ạ:

- Chị giới thiệu một người bạn → **bạn của chị được giảm [__]%** cho lần đầu
- Và **chị cũng được giảm [__]%** cho lần hẹn kế tiếp
- Không giới hạn số người chị giới thiệu

Chị chỉ cần dặn bạn nhắc tên chị khi tới tiệm là được ạ.

Cảm ơn chị nhiều lắm.`,
      ctaLabel: 'Gửi lịch đặt cho bạn bè →',
      ctaUrl: '',
      footerNote: '',
    },
  },
];
