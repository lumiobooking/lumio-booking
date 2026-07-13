// Ready-made campaigns. One click fills the whole composer, then you edit.
//
// The Body uses the tiny markup the email renderer understands:
//   ## Heading            → section title
//   - text                → green-tick bullet
//   [[PLAN]]  Name | Price | tagline | feat; feat; feat      → price card
//   [[PLAN*]] …           → the SAME card, highlighted (use it for the offer)
//   [[NOTE]] text         → soft grey note box
//   [[DIVIDER]]           → hairline

export interface Preset {
  label: string;
  draft: {
    name: string; subject: string; fromName: string; preheader: string;
    heading: string; body: string; ctaLabel: string; ctaUrl: string; footerNote: string;
  };
}

const LUMIO_FOOTER = 'Lumio Agency LLC · 5900 Balcones Drive STE 100, Austin, TX 78731 · (512) 886-8189 · support@lumioagency.com';
const AUDIT = 'https://lumioagency.com/#contact';

/** Lumio → salon owners. Platform (Super Admin) campaigns. */
export const LUMIO_PRESETS: Preset[] = [
  {
    label: '💎 Trọn gói marketing — $179 (VN)',
    draft: {
      name: 'All-in-One $179 — pitch (VN)',
      subject: 'Trọn gói online cho tiệm — $179/tháng (thay vì $393)',
      fromName: 'Lumio Agency',
      preheader: 'Social + Google Maps + LumioBooking, một giá. Website chỉ $150. Không hợp đồng dài hạn.',
      heading: 'Anh chị lo chuyên môn. Phần online để Lumio lo.',
      body: `Chào anh chị,

Em là Lumio Agency — công ty ở Austin, Texas, chuyên làm online cho tiệm nail, spa và nhà hàng người Việt tại Mỹ & Canada.

Em viết email này vì em thấy chủ tiệm nào cũng gặp đúng mấy chuyện sau:

- Khách tìm trên Google Maps mà không thấy tiệm mình
- Facebook, TikTok bỏ trống, cả tháng không có bài mới
- Khách muốn đặt lịch thì phải gọi điện, gọi không ai bắt máy là mất khách
- Website cũ, chậm, mở trên điện thoại nhìn không chuyên nghiệp
- Và đau nhất: không biết tiền marketing đang đi về đâu

## Bình thường, mỗi thứ là một gói riêng

[[PLAN]] Lumio Social Care | $45/tháng | Chăm sóc tất cả kênh social | FB, IG, TikTok, Shorts, Yelp; Nội dung đều đặn ~2 ngày/lần; Theo mẫu ngành, chỉnh riêng cho tiệm
[[PLAN]] Lumio Growth (Map) | $279/tháng | Tăng hiển thị Google Maps | Google Maps SEO chuyên sâu; Tối ưu Google Business Profile; Chiến lược đánh giá + tín hiệu local; Theo dõi lượt gọi & lượt chỉ đường
[[PLAN]] LumioBooking Pro | $69/tháng | Phần mềm quản lý tiệm | Đặt lịch online 24/7; POS & thanh toán; AI trả lời điện thoại và Messenger; Lương thợ, tip, báo cáo nguồn khách

[[NOTE]] Cộng lại: $393/tháng.

## Tháng này Lumio gộp tất cả lại — một giá

[[PLAN*]] Lumio All-in-One | $179/tháng | Tất cả những gì bên trên, một giá duy nhất | Social đa kênh (FB · IG · TikTok · Yelp); Google Maps SEO + tối ưu hồ sơ Google; LumioBooking Pro đầy đủ tính năng; Báo cáo minh bạch hằng tháng, kèm ảnh chụp nguồn; Hỗ trợ song ngữ Việt – Anh

[[NOTE]] Tiết kiệm $214 mỗi tháng. Giá ra mắt, áp dụng cho số lượng tiệm giới hạn — khoá giá suốt thời gian anh chị còn dùng.

[[DIVIDER]]

## Và website — chỉ $150

Website riêng cho tiệm: nhanh, chuẩn điện thoại, song ngữ Việt – Anh, gắn thẳng nút đặt lịch LumioBooking. Trả một lần $150, không phí ẩn.

## Vì sao anh chị nên tin Lumio

- Anh chị sở hữu 100% tài khoản — Google, Facebook, website đều đứng tên anh chị
- Không hợp đồng dài hạn, huỷ bất cứ lúc nào
- Không hứa "top 1 Google". Lumio chỉ báo cáo số liệu đã xác minh, kèm ảnh chụp màn hình
- Doanh nghiệp đăng ký thật: Lumio Agency LLC, Austin, Texas — anh chị gọi được, ghé được

Anh chị chưa cần quyết gì cả. Cứ đặt một buổi **audit miễn phí** — Lumio xem hiện trạng tiệm anh chị trên Google và Facebook, chỉ ra chỗ đang mất khách, rồi gợi ý bước tiếp theo. Không ràng buộc.

Cảm ơn anh chị đã đọc tới đây.

Việt Nguyễn
Founder, Lumio Agency`,
      ctaLabel: 'Đặt lịch audit miễn phí →',
      ctaUrl: AUDIT,
      footerNote: LUMIO_FOOTER,
    },
  },
  {
    label: '💎 All-in-One $179 (EN)',
    draft: {
      name: 'All-in-One $179 — pitch (EN)',
      subject: 'Everything your salon needs online — $179/mo (instead of $393)',
      fromName: 'Lumio Agency',
      preheader: 'Social + Google Maps + booking software, one price. Website only $150. No long contract.',
      heading: 'You run the salon. We run the online side.',
      body: `Hi {{name}},

We're Lumio Agency — an Austin, Texas company that handles the online side for nail salons, spas and restaurants across the US & Canada.

Most owners we meet are stuck on the same five things:

- Customers search Google Maps and don't find you
- Facebook and TikTok sit empty for weeks
- People have to call to book — and a missed call is a lost customer
- The website is old, slow, and looks wrong on a phone
- And the worst one: no idea where the marketing money actually goes

## Normally these are three separate plans

[[PLAN]] Lumio Social Care | $45/mo | All your social channels, handled | FB, IG, TikTok, Shorts, Yelp; Fresh content every ~2 days; Industry templates, tailored to your shop
[[PLAN]] Lumio Growth (Map) | $279/mo | Get found on Google Maps | In-depth Google Maps SEO; Google Business Profile optimisation; Review strategy + local signals; Calls & directions tracking
[[PLAN]] LumioBooking Pro | $69/mo | The software that runs your shop | 24/7 online booking; POS & payments; AI that answers your phone and Messenger; Payroll, tips, and where your customers came from

[[NOTE]] That's $393 a month.

## This month, all of it — one price

[[PLAN*]] Lumio All-in-One | $179/mo | Everything above, one price | Multi-channel social (FB · IG · TikTok · Yelp); Google Maps SEO + profile optimisation; LumioBooking Pro, every feature; Honest monthly reporting with source screenshots; Bilingual support, English & Vietnamese

[[NOTE]] That's $214 saved every month. Launch pricing, limited number of shops — and your price is locked for as long as you stay.

[[DIVIDER]]

## And a website — just $150

Fast, mobile-first, bilingual, with your LumioBooking button built in. One payment of $150. No hidden fees.

## Why owners trust us

- You own 100% of your accounts — Google, Facebook, the website, all in your name
- No long-term contract. Cancel any time
- We never promise "#1 on Google". We report verified numbers only, with screenshots
- A real registered business: Lumio Agency LLC, Austin, Texas — call us, or come see us

You don't have to decide anything today. Book a **free audit** — we'll look at your Google and Facebook presence, show you exactly where customers are slipping away, and tell you what we'd do next. No strings.

Thanks for reading this far.

Viet Nguyen
Founder, Lumio Agency`,
      ctaLabel: 'Book a free audit →',
      ctaUrl: AUDIT,
      footerNote: LUMIO_FOOTER,
    },
  },
  {
    label: '🖥️ Website $150 (VN)',
    draft: {
      name: 'Website $150 (VN)',
      subject: 'Website riêng cho tiệm — $150, trả một lần',
      fromName: 'Lumio Agency',
      preheader: 'Nhanh, chuẩn điện thoại, song ngữ Việt – Anh, gắn sẵn nút đặt lịch. Không phí ẩn.',
      heading: 'Tiệm anh chị xứng đáng có một website tử tế',
      body: `Chào anh chị,

Khách lạ tìm thấy tiệm trên Google, bấm vào website — và thấy một trang cũ, chậm, mở trên điện thoại chữ bé tí. Họ thoát ra, bấm vào tiệm kế bên.

Lumio làm website cho tiệm với đúng một mức giá: **$150, trả một lần.**

## Anh chị nhận được gì

- Website nhanh, đẹp, **chuẩn điện thoại** (90% khách xem bằng điện thoại)
- **Song ngữ Việt – Anh**, khách nào cũng đọc được
- Gắn sẵn **nút Đặt lịch** nối thẳng vào LumioBooking — khách đặt được ngay trên web
- Chuẩn Google: tên tiệm, địa chỉ, giờ mở cửa, bản đồ, đánh giá
- Anh chị **sở hữu website và tên miền** — đứng tên anh chị, không phải tên Lumio

[[NOTE]] $150 trả một lần. Không phí ẩn, không ràng buộc. Anh chị chỉ trả thêm phí tên miền + hosting theo giá gốc.

Anh chị gửi em tên tiệm và link Google Maps, em xem rồi báo lại chính xác website tiệm anh chị sẽ trông như thế nào.`,
      ctaLabel: 'Nhận bản demo miễn phí →',
      ctaUrl: AUDIT,
      footerNote: LUMIO_FOOTER,
    },
  },
];

/** A salon → its own customers. */
export const SALON_PRESETS: Preset[] = [
  {
    label: '🎁 Ưu đãi cho khách quen',
    draft: {
      name: 'Ưu đãi khách quen',
      subject: 'Cảm ơn {{name}} — tặng chị 20% cho lần tới',
      fromName: '',
      preheader: 'Ưu đãi riêng cho khách quen. Đặt lịch online chỉ mất 40 giây.',
      heading: 'Cảm ơn {{name}} đã tin tưởng tiệm',
      body: `Chào {{name}},

Cảm ơn chị đã ghé tiệm. Để cảm ơn khách quen, tiệm gửi chị một ưu đãi nhỏ:

- **Giảm 20%** cho lần hẹn tiếp theo
- Áp dụng cho tất cả dịch vụ
- Đặt lịch online, chọn đúng thợ chị thích

Chỉ cần bấm nút bên dưới, chọn ngày giờ, xong trong chưa tới một phút.

Hẹn gặp lại chị!`,
      ctaLabel: 'Đặt lịch ngay →',
      ctaUrl: '',
      footerNote: '',
    },
  },
];
