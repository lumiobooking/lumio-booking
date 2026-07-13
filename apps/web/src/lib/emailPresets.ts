// Ready-made campaigns. One click fills the whole composer, then you edit.
//
// The Body uses the tiny markup the email renderer understands:
//   ## Heading            → section title
//   - text                → green-tick bullet
//   [[PLAN]]  Name | Price | tagline | feat; feat; feat      → price card
//   [[PLAN*]] …           → the SAME card, highlighted (use it for the offer)
//   [[NOTE]] text         → soft grey note box
//   [[DIVIDER]]           → hairline
// URLs, phone numbers and email addresses inside the copy are auto-linked.

export interface Preset {
  label: string;
  draft: {
    name: string; subject: string; fromName: string; preheader: string;
    heading: string; body: string; ctaLabel: string; ctaUrl: string; footerNote: string;
  };
}

const FOOTER = 'Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731 · (512) 886-8189 · support@lumioagency.com';
const AUDIT = 'https://lumioagency.com/#contact';

/** The signature block — a real person, reachable three ways. */
const SIGN_VN = `[[DIVIDER]]

Anh chị cứ nhắn thẳng cho em, không cần qua ai cả:

- **Việt Nguyễn** — Lumio Agency LLC, Austin, Texas
- Gọi hoặc nhắn tin: (512) 886-8189
- Facebook: https://www.facebook.com/vietnguyen.lumio
- Email: support@lumioagency.com
- Website: https://lumioagency.com  ·  Phần mềm: https://lumiobooking.com

Em cảm ơn anh chị đã dành thời gian đọc tới đây.

Trân trọng,
Việt Nguyễn
Lumio Agency`;

const SIGN_EN = `[[DIVIDER]]

Reply to this email, or reach me directly — you'll get me, not a call centre:

- **Viet Nguyen** — Lumio Agency LLC, Austin, Texas
- Call or text: (512) 886-8189
- Facebook: https://www.facebook.com/vietnguyen.lumio
- Email: support@lumioagency.com
- Website: https://lumioagency.com  ·  Software: https://lumiobooking.com

Thank you for reading this far.

Warm regards,
Viet Nguyen
Lumio Agency`;

/** Lumio → salon owners. Platform (Super Admin) campaigns. */
export const LUMIO_PRESETS: Preset[] = [
  {
    // FORM 2 — the lead magnet. Not one price anywhere on purpose: the only job of
    // this email is to get a reply. Price kills replies on a cold email.
    label: '🎯 FORM 2 · Audit miễn phí — kéo khách liên hệ (VN)',
    draft: {
      name: 'Audit miễn phí — lead magnet (VN)',
      subject: 'Khách gõ “nail salon near me” — tiệm mình có hiện ra không ạ?',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Em xem giúp anh chị miễn phí. Không bán gì cả — chỉ cần nhắn em tên tiệm.',
      heading: 'Có thể tiệm mình đang mất khách mà không hay biết',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas. Em xin phép làm phiền anh chị đúng hai phút.

Tối thứ Sáu, 7 giờ. Một người khách đứng cách tiệm mình ba con đường, mở điện thoại gõ **“nail salon near me”**.

Tiệm mình có hiện ra không?

Nếu không — người khách đó **không biết là mình tồn tại**. Họ bấm vào tiệm hiện lên đầu tiên. Và cái ghế trống trong tiệm mình tối đó, **không ai tính là mất khách cả** — vì có ai gọi tới đâu mà biết.

## Anh chị thử tự trả lời 5 câu này

- Gõ “nail salon near me” trên điện thoại — tiệm mình đứng ở đâu?
- Bài đăng gần nhất trên Facebook / TikTok của tiệm là **từ bao giờ**?
- Tuần rồi tiệm mình có **bao nhiêu cuộc gọi nhỡ**?
- Mở website tiệm trên điện thoại — mất mấy giây? Chữ có đọc được không?
- Tháng rồi khách mới đến từ đâu — Google, Facebook, hay đi ngang qua?

[[NOTE]] Nếu có **từ 2 câu trở lên anh chị không trả lời được** — thì đó chính là chỗ tiền đang lặng lẽ chảy ra khỏi tiệm mỗi tháng.

## Em xin làm giúp anh chị một bản đánh giá — miễn phí

Em không gửi email này để bán gì cả. Em muốn tặng anh chị một thứ dùng được ngay:

- **Vị trí tiệm mình trên Google Maps** với 5 từ khoá mà khách hay tìm nhất
- **So sánh hồ sơ Google** của tiệm với 3 tiệm gần nhất — hơn thua ở đâu, thấy rõ
- **Chấm điểm website**: tốc độ, hiển thị trên điện thoại — kèm ảnh chụp màn hình
- **Ước tính số khách có thể đang mất mỗi tháng** — em nói rõ cách tính, không bịa
- **3 việc nên làm ngay.** Anh chị **tự làm cũng được** — không cần thuê em

[[NOTE]] Bản đánh giá này là **của anh chị**. Nếu xem xong anh chị thấy tự xử lý được, cứ tự làm — em không gọi làm phiền, không nài nỉ.

## Vì sao em làm không công?

Nói thẳng: vì em tin rằng khi anh chị thấy em làm việc tử tế và nói thật, có ngày cần tới thì anh chị sẽ nhớ tới em. Chỉ vậy thôi.

Và vì em làm bằng tay chứ không phải máy chạy tự động, nên **mỗi tuần em chỉ nhận 5 tiệm**.

## Anh chị chỉ cần làm một việc

Trả lời email này đúng **hai dòng**:

> **Tên tiệm** · **Link Google Maps** (hoặc số điện thoại tiệm)

Trong vòng **48 tiếng**, em gửi lại bản đánh giá. Không họp hành, không ai gọi điện làm phiền anh chị.

Hoặc nếu tiện hơn, anh chị nhắn thẳng cho em qua điện thoại hay Facebook bên dưới — em trả lời nhanh, bằng tiếng Việt.

${SIGN_VN}

P.S. Nếu anh chị chỉ tò mò muốn biết **tiệm mình đang đứng thứ mấy trên Google Maps**, nhắn em số điện thoại tiệm thôi cũng được. Em tra rồi nhắn lại cho anh chị **ngay trong hôm nay** — không cần cam kết gì hết.`,
      ctaLabel: 'Nhận bản đánh giá miễn phí →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
  {
    label: '🎯 FORM 2 · Free audit — lead magnet (EN)',
    draft: {
      name: 'Free audit — lead magnet (EN)',
      subject: 'Someone just searched “nail salon near me” — did you show up?',
      fromName: 'Viet Nguyen · Lumio Agency',
      preheader: 'I’ll check it for you, free. Nothing to buy — just send me your salon name.',
      heading: 'You may be losing customers without ever knowing it',
      body: `Dear {{name}},

My name is **Viet Nguyen**, from **Lumio Agency** in Austin, Texas. Two minutes of your time, that's all I'm asking for.

Friday night, 7pm. Someone is standing three blocks from your salon. They pull out their phone and type **“nail salon near me.”**

Did your shop come up?

If it didn't, that customer **doesn't know you exist**. They tapped the first salon on the list. And the empty chair in your shop that night? **Nobody counted it as a lost customer** — because nobody ever called.

## Try answering these five questions

- Type “nail salon near me” on your phone — where does your salon land?
- When was the **last post** on your Facebook or TikTok?
- How many **missed calls** did you have last week?
- Open your website on a phone — how many seconds? Can you even read it?
- Where did last month's new customers come from — Google, Facebook, or walking past?

[[NOTE]] If you couldn't answer **two or more** of those — that is exactly where money is quietly leaking out of your business every month.

## Let me put together a free audit for you

I'm not emailing to sell you anything. I want to hand you something you can use today:

- **Where you rank on Google Maps** for the 5 searches your customers actually use
- **Your Google profile vs. the 3 salons nearest you** — exactly where you win and lose
- **A website health score**: speed and mobile display, with screenshots
- **An estimate of how many customers you may be losing each month** — with the maths shown, not invented
- **The 3 things to fix first.** You can **do them yourself** — you don't need to hire me

[[NOTE]] The audit is **yours to keep**. If you read it and decide you can handle it in-house, go right ahead — I won't chase you or call you.

## Why would I do this for free?

Straight answer: because when you see that I do honest work and tell you the truth, you'll remember me the day you actually need someone. That's the whole plan.

And because I do these by hand — not with software — **I only take 5 salons a week**.

## All you have to do is this

Reply to this email with **two lines**:

> **Salon name** · **Google Maps link** (or your salon's phone number)

Within **48 hours** I'll send the audit back. No meeting, no sales call, nobody hounding you.

Or just call or message me directly using the details below. I answer fast, in English or Vietnamese.

${SIGN_EN}

P.S. If you're only curious about **where you currently rank on Google Maps**, just send me your salon's phone number. I'll look it up and text you back **today** — no commitment of any kind.`,
      ctaLabel: 'Get my free audit →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
  {
    label: '📋 FORM 1 · Báo giá đầy đủ (VN)',
    draft: {
      name: 'Chào dịch vụ tổng thể — VN',
      subject: 'Tiệm anh chị đang mất khách ở chỗ nào? Em chỉ giúp anh chị xem — miễn phí',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Google Maps · Social · Website · Phần mềm đặt lịch — chỉ từ $45/tháng. Audit miễn phí, không ràng buộc.',
      heading: 'Anh chị lo tay nghề. Phần online, để em lo.',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** — công ty đăng ký tại Austin, Texas. Em và đội ngũ của em chuyên lo phần online cho tiệm nail, spa và nhà hàng của người Việt mình tại Mỹ và Canada.

Em viết email này không phải để bán hàng vội. Em chỉ muốn hỏi anh chị một câu:

**Tháng vừa rồi, tiệm mình mất bao nhiêu khách mà không hề hay biết?**

Em hỏi vậy vì chủ tiệm nào em gặp cũng đang rơi khách ở đúng mấy chỗ này:

- Khách mở Google Maps tìm tiệm nail gần nhà — **tiệm mình không hiện ra**, tiệm bên cạnh hiện
- Facebook, TikTok bỏ trống cả tháng — khách lạ vào xem, thấy bài cuối từ năm ngoái, họ đi luôn
- Khách gọi tới lúc tiệm đang đông, **không ai bắt máy** — khách gọi tiệm khác
- Website cũ, mở trên điện thoại chữ bé xíu, khách thoát ra trong 3 giây
- Và đau nhất: **tiền quảng cáo đổ ra mà không biết đi về đâu**

Mỗi cái đó, một mình thì nhỏ. Cộng lại cả tháng thì đó là **tiền thật** đi ra khỏi cửa tiệm.

## Lumio làm gì cho tiệm anh chị

[[PLAN]] Lumio Social Care | $45/tháng | Bắt đầu nhẹ nhàng — chỉ lo phần social | Đăng đều FB, IG, TikTok, Shorts, Yelp; Nội dung mới ~2 ngày/lần, không để trang chết; Theo mẫu ngành, chỉnh riêng cho tiệm mình; Chưa gồm Google Maps SEO và báo cáo
[[PLAN]] Lumio Boost + LumioBooking | $179/tháng | Nền tảng — social đều tay và hệ thống đặt lịch | Social đa kênh: FB, IG, TikTok, Shorts, Yelp; Nội dung đều đặn ~2 ngày/lần; Tối ưu hồ sơ Google Business Profile; Link in bio + duyệt nội dung trước khi đăng; Phần mềm LumioBooking đặt lịch online 24/7; Báo cáo tháng ngắn gọn, dễ hiểu
[[PLAN*]] Lumio Growth (Pro) | $279/tháng | Đầy đủ nhất — thêm Google Maps SEO chuyên sâu | Bao gồm toàn bộ gói $179; Google Maps SEO chuyên sâu — để khách tìm là thấy tiệm mình; Chiến lược đánh giá + tín hiệu local; Theo dõi lượt hiển thị, lượt gọi, lượt chỉ đường; Báo cáo minh bạch kèm ảnh chụp màn hình nguồn

[[NOTE]] Gói $179 và $279 đều **đã bao gồm phần mềm LumioBooking** — đặt lịch online, nhắc khách tự động, POS tính tiền, quản lý thợ và báo cáo nguồn khách. Anh chị không phải trả thêm đồng nào cho phần mềm.

Anh chị chưa muốn đi xa? **Bắt đầu ở gói $45** cũng được — để trang social của tiệm sống lại trước đã. Khi nào thấy hiệu quả thì nâng lên, em không ép.

## Và website — chỉ $150, trả một lần

Website riêng cho tiệm: nhanh, đẹp, **chuẩn điện thoại**, song ngữ Việt – Anh, gắn sẵn nút Đặt lịch nối thẳng vào LumioBooking. Anh chị **sở hữu website và tên miền**, đứng tên anh chị.

[[NOTE]] $150 trả một lần. Không phí ẩn, không ràng buộc.

## Vì sao anh chị nên tin em

- Anh chị **sở hữu 100% tài khoản** — Google, Facebook, website đều đứng tên anh chị. Ngừng hợp tác lúc nào cũng giữ nguyên tất cả
- **Không hợp đồng dài hạn.** Em khuyến nghị tối thiểu 3 tháng để công việc kịp có tác dụng, không phải để trói anh chị
- Em **không hứa "top 1 Google"** — ai hứa điều đó là không thật thà. Em chỉ báo cáo số liệu đã xác minh, kèm ảnh chụp màn hình nguồn
- **Doanh nghiệp thật:** Lumio Agency LLC, đăng ký tại Texas, văn phòng ở 5900 Balcones Drive STE 100, Austin, TX. Anh chị gọi được, ghé được, nhìn mặt được

## Bước tiếp theo rất nhẹ nhàng

Anh chị **chưa cần quyết gì cả, cũng chưa tốn đồng nào.**

Em xin **20 phút** để làm một buổi **audit miễn phí**: em xem hồ sơ Google, Facebook và website của tiệm mình, chỉ ra chính xác chỗ đang mất khách, rồi nói thẳng anh chị nên làm gì trước, làm gì sau. Nếu anh chị thấy chưa cần Lumio, em vẫn gửi anh chị bản đánh giá đó — miễn phí, giữ luôn.

Anh chị chỉ cần bấm nút bên dưới, hoặc nhắn thẳng cho em.

${SIGN_VN}`,
      ctaLabel: 'Nhận audit miễn phí (20 phút) →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
  {
    label: '📋 FORM 1 · Full pricing (EN)',
    draft: {
      name: 'Full-service pitch — EN',
      subject: 'Where is your salon losing customers? Let me show you — free',
      fromName: 'Viet Nguyen · Lumio Agency',
      preheader: 'Google Maps · Social · Website · Booking software — from just $45/mo. Free audit, no strings.',
      heading: 'You handle the craft. I’ll handle the online side.',
      body: `Dear {{name}},

My name is **Viet Nguyen**, from **Lumio Agency** — a registered company in Austin, Texas. My team and I run the online side for Vietnamese-owned nail salons, spas and restaurants across the US and Canada.

I'm not writing to rush you into anything. I just want to ask you one question:

**How many customers did your salon lose last month without ever knowing it?**

I ask because every owner I meet is losing people in the same five places:

- Someone opens Google Maps looking for a nail salon nearby — **your shop doesn't come up**, the one next door does
- Facebook and TikTok sit empty for months. A new customer looks you up, sees a post from last year, and moves on
- The phone rings while everyone's hands are busy — **nobody picks up** — and that customer calls someone else
- Your website is old, and on a phone the text is tiny. People leave in three seconds
- And the worst one: **money goes into marketing and nobody knows where it lands**

Any one of these is small. Add them up over a month and it is **real money** walking out of your door.

## What Lumio does for you

[[PLAN]] Lumio Social Care | $45/mo | Start small — social only | FB, IG, TikTok, Shorts, Yelp posted for you; Fresh content every ~2 days, never a dead page; Industry templates, tailored to your shop; No Maps SEO or reporting at this level
[[PLAN]] Lumio Boost + LumioBooking | $179/mo | The foundation — steady social and a real booking system | Multi-channel social: FB, IG, TikTok, Shorts, Yelp; Fresh content every ~2 days; Google Business Profile optimisation; Link in bio + you approve content before it posts; LumioBooking software — 24/7 online booking; A short, plain-English monthly report
[[PLAN*]] Lumio Growth (Pro) | $279/mo | The full package — adds deep Google Maps SEO | Everything in the $179 plan; In-depth Google Maps SEO — so people searching actually find you; Review strategy + local signals; Tracking for impressions, calls and directions; Honest reporting with source screenshots

[[NOTE]] The $179 and $279 plans **already include the LumioBooking software** — online booking, automatic reminders, POS checkout, staff management and customer-source reporting. You never pay extra for it.

Not ready for all that? **Start at $45** and just bring your social pages back to life. Move up when you see it working — I won't push you.

## And a website — just $150, one payment

A proper website for your shop: fast, **built for phones first**, bilingual English/Vietnamese, with your booking button wired straight into LumioBooking. **You own the site and the domain**, in your name.

[[NOTE]] $150, one time. No hidden fees, no lock-in.

## Why you can trust me

- **You own 100% of your accounts** — Google, Facebook, the website, all in your name. Walk away any time and you keep everything
- **No long-term contract.** I suggest 3 months minimum so the work has time to land — not to tie you down
- I will **never promise "#1 on Google."** Anyone who does isn't being straight with you. I report verified numbers only, with screenshots of the source
- **A real business:** Lumio Agency LLC, registered in Texas, office at 5900 Balcones Drive STE 100, Austin, TX. Call me, email me, or come see me

## The next step is easy

You don't have to decide anything today, and it costs you nothing.

Give me **20 minutes** for a **free audit**: I'll go through your Google profile, your social pages and your website, show you exactly where customers are slipping away, and tell you straight what to fix first. If you decide Lumio isn't for you, keep the audit anyway — it's yours.

Just tap the button below, or reach me directly.

${SIGN_EN}`,
      ctaLabel: 'Get my free 20-minute audit →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
  {
    label: '🖥️ Phụ · Website $150 (VN)',
    draft: {
      name: 'Website $150 — VN',
      subject: 'Website riêng cho tiệm — $150, trả một lần, anh chị sở hữu luôn',
      fromName: 'Việt Nguyễn · Lumio Agency',
      preheader: 'Nhanh, chuẩn điện thoại, song ngữ Việt – Anh, gắn sẵn nút đặt lịch. Không phí ẩn.',
      heading: 'Tiệm mình xứng đáng có một website tử tế',
      body: `Kính chào anh/chị,

Em là **Việt Nguyễn**, bên **Lumio Agency** ở Austin, Texas.

Em kể anh chị nghe một chuyện xảy ra mỗi ngày: khách lạ tìm thấy tiệm mình trên Google, tò mò bấm vào website — và thấy một trang cũ, chậm, mở trên điện thoại chữ bé xíu. Ba giây sau họ thoát ra, bấm vào tiệm kế bên.

Cái website đó **không làm mất tiền của anh chị**. Nó chỉ lặng lẽ **đẩy khách sang tiệm khác** thôi.

## Lumio làm website cho tiệm — đúng một mức giá

[[PLAN*]] Website trọn gói | $150 | Trả một lần, không phí ẩn | Nhanh, đẹp, **chuẩn điện thoại** — 9/10 khách xem bằng điện thoại; Song ngữ Việt – Anh; Gắn sẵn nút Đặt lịch nối thẳng LumioBooking; Chuẩn Google: tên tiệm, địa chỉ, giờ mở cửa, bản đồ, đánh giá; Anh chị sở hữu website và tên miền, đứng tên anh chị

[[NOTE]] $150 trả một lần. Anh chị chỉ trả thêm phí tên miền và hosting theo giá gốc — em không ăn chênh lệch.

## Em làm gì tiếp theo

Anh chị nhắn cho em **tên tiệm + link Google Maps**. Trong vòng 48 tiếng em gửi lại anh chị bản phác thảo website của tiệm mình — nhìn tận mắt rồi hãy quyết.

Không thích thì thôi, em không làm phiền anh chị nữa.

${SIGN_VN}`,
      ctaLabel: 'Xem bản demo website của tiệm →',
      ctaUrl: AUDIT,
      footerNote: FOOTER,
    },
  },
];

/** A salon → its own customers. */
export const SALON_PRESETS: Preset[] = [
  {
    label: '🎁 Ưu đãi cho khách quen',
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
];
