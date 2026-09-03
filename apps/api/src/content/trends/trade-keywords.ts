/**
 * What each trade should write, and what it should bid on.
 *
 * WHY THIS IS SEPARATE FROM THE TRENDS TABLE
 *
 * trend-feed.ts answers "what do we go and FETCH for this trade" — search
 * terms we spend API quota on. This file answers the two questions an owner
 * asks next: what should I publish, and what should I pay for. They pull
 * apart because the best term to MEASURE a trend with is rarely the best term
 * to BID on. "nail trends" is a fine YouTube query and a terrible ad keyword:
 * nobody typing it is about to book anything.
 *
 * THE DISTINCTION EVERYTHING TURNS ON
 *
 * Intent, not volume. A phrase with a hundred thousand searches and no intent
 * to buy costs more to chase than a phrase with four hundred and a customer
 * at the end of it. So groups are filed by what the person typing is about to
 * do:
 *
 *   book-now — an appointment, today. Lowest volume, highest value, and the
 *              only group worth real money in week one.
 *   service  — a named service; they are choosing where to have it done.
 *   design   — picking a look. Content, not ads: they book in a week, and an
 *              ad today pays to be forgotten by then.
 *   brand    — they typed a shop's name. Cheap, and defensive.
 *
 * WHY THE AD GROUPS ARE BUILT, NOT WRITTEN OUT
 *
 * Written by hand, eight trades times two markets came to the same three
 * paragraphs of advice retyped sixteen times — and advice that exists in
 * sixteen copies is advice that gets fixed in one of them. What differs per
 * trade is the VOCABULARY: what customers call the shop and what they call
 * the services. The shape of the groups, and the warnings attached to them,
 * are identical for every local service business, so they live once.
 *
 * SEO topics stay hand-written, because that is where the trade-specific
 * judgement actually is: which question a customer asks before choosing, and
 * which page nobody in that trade can be bothered to publish.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * Search volumes. Volume is local, it moves monthly, and a number written
 * into source in September is false by March. The live figures come from the
 * trends board once Google Trends or Pinterest is connected. This is the map,
 * not the measurement.
 */

import { bi, type Txt } from '../i18n';

export type AdIntent = 'book-now' | 'service' | 'design' | 'brand';

export interface AdGroup {
  name: Txt;
  intent: AdIntent;
  /** Seeds. `{city}` and `{brand}` are filled from the salon at read time — a
   *  local trade's money keywords do not exist without a place attached. */
  keywords: string[];
  note: Txt;
}

export interface SeoTopic {
  title: Txt;
  /** The queries this article is written to answer. */
  targets: string[];
  why: Txt;
  /**
   * money   — the page that takes the booking. Few; rewrite often.
   * service — one page per service the shop genuinely sells.
   * guide   — answers the question that comes BEFORE choosing a shop.
   * local   — wins "near me" for one neighbourhood.
   */
  kind: 'money' | 'service' | 'guide' | 'local';
}

export interface TradeKeywords {
  adGroups: AdGroup[];
  seoTopics: SeoTopic[];
}

/** What customers call this trade and its services. The only per-trade input
 *  the ad groups need. */
interface Vocab {
  /** How a customer names the shop: "nail salon", "lash studio". */
  shop: string;
  /** A second phrasing people really use. */
  alt: string;
  /** Services searched by name, most-wanted first. */
  services: string[];
}

// ---- the shared shape of a local service business's ad account -------------

const HOURS_WARNING = bi(
  'Nhóm duy nhất đáng bỏ tiền thật trong tuần đầu. Bắt buộc khai đúng giờ mở cửa trên Google Business — sai giờ là tiền đổ vào người đang tìm chỗ "đang mở" rồi bỏ đi.',
  'The only group worth real money in week one. Hours on Google Business must be right, or the spend lands on people looking for somewhere open, who then leave.',
);
const SERVICE_WARNING = bi(
  'Chỉ chạy dịch vụ tiệm làm được và làm giỏi. Quảng cáo một dịch vụ thợ chưa vững là cách nhanh nhất mất khách vĩnh viễn — và mất luôn đánh giá.',
  'Run only what the shop genuinely does well. Advertising a service the techs are shaky on is the fastest way to lose a customer permanently, and the review with them.',
);
const BRAND_WARNING = bi(
  'Rẻ nhất trong tất cả và hay bị bỏ quên. Không giữ tên mình thì tiệm bên cạnh đấu giá nó và lấy đúng nhóm khách đã tìm tới mình.',
  'The cheapest group there is, and the one most often skipped. Leave your name unheld and the shop down the road bids on it and takes the customers who were already looking for you.',
);

function adGroupsUS(v: Vocab): AdGroup[] {
  return [
    {
      name: bi('Đặt lịch ngay', 'Ready to book'),
      intent: 'book-now',
      keywords: [`${v.shop} near me`, `${v.shop} {city}`, `${v.shop} open now`, `${v.alt} near me`, `book ${v.shop} {city}`],
      note: HOURS_WARNING,
    },
    {
      name: bi('Theo dịch vụ', 'By service'),
      intent: 'service',
      keywords: v.services.map((s) => `${s} near me`),
      note: SERVICE_WARNING,
    },
    {
      name: bi('Giữ tên tiệm', 'Hold your own name'),
      intent: 'brand',
      keywords: ['{brand}', '{brand} {city}', `{brand} ${v.shop}`],
      note: BRAND_WARNING,
    },
  ];
}

/** Vietnamese does not put "near me" after a noun, so these are built the way
 *  people actually type: place first, or "gần đây". */
function adGroupsVN(v: Vocab): AdGroup[] {
  return [
    {
      name: bi('Đặt lịch ngay', 'Ready to book'),
      intent: 'book-now',
      keywords: [`${v.shop} {city}`, `${v.shop} gần đây`, `${v.shop} đẹp {city}`, `${v.alt} {city}`, `đặt lịch ${v.shop}`],
      note: bi(
        'Ở VN phần lớn khách tìm qua Facebook và Google Maps chứ không phải website. Hoàn thiện Google Business và fanpage trước đã, rồi mới đổ tiền vào quảng cáo tìm kiếm.',
        'In Vietnam most customers arrive through Facebook and Google Maps, not a website. Finish Google Business and the fanpage first; only then pay for search ads.',
      ),
    },
    {
      name: bi('Theo dịch vụ', 'By service'),
      intent: 'service',
      keywords: v.services.map((s) => `${s} {city}`),
      note: bi(
        'Từ khóa dịch vụ ở VN rẻ hơn Mỹ nhiều nhưng lượng tìm cũng thấp hơn — hợp chạy đều ngân sách nhỏ, không hợp kỳ vọng bùng nổ.',
        'Service keywords cost far less in Vietnam than in the US, but carry less volume too — good for a steady small budget, wrong for expecting a spike.',
      ),
    },
    {
      name: bi('Giữ tên tiệm', 'Hold your own name'),
      intent: 'brand',
      keywords: ['{brand}', '{brand} {city}', `{brand} ${v.shop}`],
      note: BRAND_WARNING,
    },
  ];
}

// ---- the per-trade material ------------------------------------------------

const VOCAB: Record<string, { US: Vocab; VN?: Vocab }> = {
  NAIL: {
    US: { shop: 'nail salon', alt: 'nail bar', services: ['gel x nails', 'acrylic nails', 'russian manicure', 'builder gel nails', 'pedicure', 'dip powder nails'] },
    VN: { shop: 'tiệm nail', alt: 'làm nail', services: ['sơn gel', 'đắp bột móng', 'vẽ móng nghệ thuật', 'úp móng', 'chăm sóc móng'] },
  },
  HAIR: {
    US: { shop: 'hair salon', alt: 'hair stylist', services: ['balayage', 'haircut', 'hair color', 'keratin treatment', 'hair extensions', 'blowout'] },
    VN: { shop: 'salon tóc', alt: 'cắt tóc', services: ['nhuộm tóc', 'uốn tóc', 'ép tóc', 'phục hồi tóc', 'highlight tóc'] },
  },
  LASH: {
    US: { shop: 'lash studio', alt: 'eyelash extensions', services: ['volume lashes', 'classic lash extensions', 'lash lift', 'lash fill', 'hybrid lashes'] },
    VN: { shop: 'nối mi', alt: 'tiệm nối mi', services: ['nối mi volume', 'nối mi classic', 'uốn mi', 'nâng mi', 'dặm mi'] },
  },
  BROW: {
    US: { shop: 'brow bar', alt: 'eyebrow salon', services: ['brow lamination', 'eyebrow threading', 'brow tint', 'brow wax', 'brow shaping'] },
    VN: { shop: 'phun mày', alt: 'chân mày thẩm mỹ', services: ['điêu khắc chân mày', 'phun mày ombre', 'tỉa chân mày', 'dáng mày chuẩn'] },
  },
  SPA: {
    US: { shop: 'day spa', alt: 'facial spa', services: ['hydrafacial', 'chemical peel', 'acne facial', 'dermaplaning', 'back facial'] },
    VN: { shop: 'spa', alt: 'spa chăm sóc da', services: ['trị mụn', 'chăm sóc da mặt', 'peel da', 'tắm trắng', 'triệt lông'] },
  },
  MASSAGE: {
    US: { shop: 'massage spa', alt: 'massage therapist', services: ['deep tissue massage', 'swedish massage', 'hot stone massage', 'prenatal massage', 'couples massage'] },
    VN: { shop: 'massage', alt: 'gội đầu dưỡng sinh', services: ['massage body', 'massage chân', 'bấm huyệt cổ vai gáy', 'xông hơi', 'massage đá nóng'] },
  },
  PMU: {
    US: { shop: 'permanent makeup', alt: 'pmu artist', services: ['lip blush', 'powder brows', 'microblading', 'eyeliner tattoo', 'scalp micropigmentation'] },
    VN: { shop: 'phun xăm thẩm mỹ', alt: 'phun xăm', services: ['phun môi collagen', 'phun mày ombre', 'phun mí mắt', 'điêu khắc chân mày'] },
  },
  SALON: {
    US: { shop: 'beauty salon', alt: 'nail salon', services: ['manicure', 'pedicure', 'haircut', 'facial', 'eyelash extensions'] },
    VN: { shop: 'tiệm làm đẹp', alt: 'salon làm đẹp', services: ['làm nail', 'cắt tóc', 'nối mi', 'chăm sóc da'] },
  },
};

/** The trade-specific judgement: the question a customer asks before choosing,
 *  and the page nobody in the trade bothers to publish. */
const TOPICS: Record<string, { US: SeoTopic[]; VN?: SeoTopic[] }> = {
  NAIL: {
    US: [
      { kind: 'money', title: bi('Bảng giá nail tại {city} — {year}', 'Nail prices in {city} — {year}'),
        targets: ['nail prices {city}', 'how much are acrylic nails', 'gel x price', 'full set cost'],
        why: bi('Giá là câu hỏi khách hỏi trước khi gọi, và gần như không tiệm nào chịu đăng. Đăng ra là chiếm trang.',
                'Price is the question people ask before calling, and almost no shop will publish it. Publishing takes the page.') },
      { kind: 'guide', title: bi('Gel-X khác gì đắp bột và gel thường', 'Gel-X vs acrylic vs regular gel'),
        targets: ['what is gel x', 'gel x vs acrylic', 'is gel x bad for nails', 'how long does gel x last'],
        why: bi('Khách đọc bài này trước khi chọn tiệm. Ai giải thích rõ nhất thường là người được đặt lịch.',
                'People read this before choosing a shop. Whoever explains it best usually gets the booking.') },
      { kind: 'service', title: bi('Russian manicure: vì sao giữ lâu hơn', 'Russian manicure: why it lasts longer'),
        targets: ['russian manicure', 'russian manicure near me', 'is russian manicure worth it'],
        why: bi('Dịch vụ giá cao, ít tiệm ở thị trấn nhỏ nhận làm — trang này gần như không ai tranh.',
                'A high-ticket service few small-town shops offer — this page has almost no competition.') },
    ],
    VN: [
      { kind: 'money', title: bi('Bảng giá làm nail tại {city} {year}', 'Nail price list in {city}, {year}'),
        targets: ['giá làm nail', 'giá sơn gel', 'đắp bột giá bao nhiêu'],
        why: bi('Khách VN hỏi giá đầu tiên, gần như luôn luôn. Đăng công khai là lọc sẵn khách và bớt hẳn thời gian nhắn tin.',
                'Vietnamese customers ask price first, nearly every time. Publishing it filters customers in advance and saves hours of messaging.') },
      { kind: 'guide', title: bi('Sơn gel và đắp bột khác nhau thế nào', 'Gel polish vs acrylic, explained'),
        targets: ['sơn gel là gì', 'đắp bột có hại không', 'sơn gel giữ được bao lâu'],
        why: bi('Câu hỏi khách mới luôn hỏi trước lần đầu tới tiệm.', 'What every first-time customer asks before walking in.') },
      { kind: 'guide', title: bi('Cách giữ móng bền sau khi làm', 'Making a set last after you leave'),
        targets: ['cách giữ nail lâu', 'móng bị bong', 'chăm sóc móng sau khi làm'],
        why: bi('Dùng luôn làm tin nhắn chăm sóc sau khi khách về — kéo khách quay lại.',
                'Doubles as the post-visit care message that brings customers back.') },
    ],
  },
  HAIR: {
    US: [
      { kind: 'money', title: bi('Bảng giá làm tóc tại {city} — {year}', 'Hair prices in {city} — {year}'),
        targets: ['balayage cost', 'hair color prices {city}', 'how much is a haircut'],
        why: bi('Giá nhuộm chênh nhau rất lớn giữa các salon, nên đây là trang khách đọc kỹ nhất trước khi đặt.',
                'Colour prices vary wildly between salons, which makes this the page people read hardest before booking.') },
      { kind: 'guide', title: bi('Balayage khác gì highlight', 'Balayage vs highlights'),
        targets: ['balayage vs highlights', 'what is balayage', 'balayage upkeep'],
        why: bi('Khách hay đặt nhầm dịch vụ vì không phân biệt được — bài này vừa kéo khách vừa giảm ca làm lại.',
                'Customers book the wrong service because they cannot tell these apart — this page brings traffic and cuts redo appointments.') },
      { kind: 'guide', title: bi('Bao lâu nên dặm chân tóc', 'How often to touch up your roots'),
        targets: ['how often to touch up roots', 'root touch up cost', 'when to redo balayage'],
        why: bi('Bài này trực tiếp tạo lịch quay lại — khách đọc xong biết mình nên quay lại tuần nào.',
                'This page directly creates rebookings — the reader leaves knowing which week to come back.') },
    ],
  },
  LASH: {
    US: [
      { kind: 'money', title: bi('Bảng giá nối mi tại {city} — {year}', 'Lash extension prices in {city} — {year}'),
        targets: ['lash extension prices', 'how much are volume lashes', 'lash fill cost {city}'],
        why: bi('Khách nối mi so giá rất kỹ vì phải quay lại dặm mỗi 2–3 tuần — giá là quyết định dài hạn, không phải một lần.',
                'Lash customers compare prices carefully because they return for fills every two to three weeks — price is a recurring decision, not a one-off.') },
      { kind: 'guide', title: bi('Classic, hybrid hay volume — chọn kiểu nào', 'Classic, hybrid or volume — which set is for you'),
        targets: ['classic vs volume lashes', 'what are hybrid lashes', 'best lash extensions for hooded eyes'],
        why: bi('Khách mới gần như luôn kẹt ở câu hỏi này. Bài trả lời được là bài chốt được lịch.',
                'Nearly every new customer is stuck on exactly this. The page that answers it books the appointment.') },
      { kind: 'guide', title: bi('Cách giữ mi lâu và chăm mi đúng', 'Lash aftercare that actually keeps them on'),
        targets: ['lash extension aftercare', 'how long do lash extensions last', 'why are my lashes falling out'],
        why: bi('Mi rụng sớm là lý do khách bỏ tiệm mà không nói. Dạy chăm mi là giữ khách.',
                'Lashes falling early is why customers leave without saying so. Teaching aftercare is retention.') },
    ],
  },
  BROW: {
    US: [
      { kind: 'service', title: bi('Brow lamination là gì, giữ được bao lâu', 'Brow lamination: what it is and how long it lasts'),
        targets: ['what is brow lamination', 'brow lamination near me', 'how long does brow lamination last'],
        why: bi('Dịch vụ đang lên, nhiều người tò mò nhưng chưa hiểu — đúng lúc để chiếm trang.',
                'A rising service plenty of people are curious about and few understand — the right moment to take the page.') },
      { kind: 'guide', title: bi('Threading, wax hay lamination — chọn gì', 'Threading, waxing or lamination — which one'),
        targets: ['threading vs waxing eyebrows', 'is threading better', 'eyebrow shaping options'],
        why: bi('Khách quyết định phương pháp trước khi quyết định tiệm.', 'People choose the method before they choose the shop.') },
    ],
  },
  SPA: {
    US: [
      { kind: 'money', title: bi('Bảng giá chăm sóc da tại {city}', 'Facial and skincare prices in {city}'),
        targets: ['hydrafacial cost', 'facial prices {city}', 'chemical peel price'],
        why: bi('Dịch vụ da có khoảng giá rất rộng — không công khai là khách bỏ qua sang chỗ có ghi.',
                'Skin services span a huge price range — leave it unpublished and people move on to a shop that states it.') },
      { kind: 'guide', title: bi('Bao lâu nên chăm sóc da một lần', 'How often you should actually get a facial'),
        targets: ['how often should i get a facial', 'facial for acne how many sessions'],
        why: bi('Bài này biến một lần tới thành liệu trình — thay đổi hẳn giá trị vòng đời khách.',
                'This page turns a single visit into a course of treatment, which changes customer lifetime value outright.') },
    ],
    VN: [
      { kind: 'money', title: bi('Bảng giá dịch vụ spa tại {city} {year}', 'Spa price list in {city}, {year}'),
        targets: ['giá trị mụn', 'giá chăm sóc da mặt', 'bảng giá spa'],
        why: bi('Giá là câu hỏi đầu tiên, và là lý do khách nhắn tin rồi im lặng khi không được trả lời.',
                'Price is the first question, and the reason a customer messages and then goes quiet when it goes unanswered.') },
      { kind: 'guide', title: bi('Trị mụn bao lâu thì hết — lộ trình thật', 'How long acne treatment really takes'),
        targets: ['trị mụn bao lâu', 'lộ trình trị mụn', 'trị mụn ở spa có hết không'],
        why: bi('Khách kỳ vọng sai là nguồn gốc mọi khiếu nại trong ngành này. Nói thật trước là giữ được khách.',
                'Wrong expectations are the root of every complaint in this trade. Saying it plainly up front is what keeps the customer.') },
    ],
  },
  MASSAGE: {
    US: [
      { kind: 'guide', title: bi('Deep tissue hay Swedish — chọn loại nào', 'Deep tissue or Swedish — which to book'),
        targets: ['deep tissue vs swedish', 'what massage should i get', 'massage for back pain'],
        why: bi('Khách đặt nhầm loại rồi thất vọng — bài này vừa kéo khách vừa giảm review xấu.',
                'People book the wrong style and leave disappointed — this page brings traffic and prevents bad reviews.') },
      { kind: 'money', title: bi('Giá massage tại {city} và nên đi bao lâu một lần', 'Massage prices in {city} and how often to come'),
        targets: ['massage prices {city}', 'how much is a 60 minute massage', 'how often should you get a massage'],
        why: bi('Gộp giá với tần suất trong một bài là cách tự nhiên nhất để bán gói.',
                'Putting price and frequency on one page is the most natural way to sell a package.') },
    ],
    VN: [
      { kind: 'service', title: bi('Gội đầu dưỡng sinh là gì, khác gội thường thế nào', 'What "goi dau duong sinh" is, and how it differs'),
        targets: ['gội đầu dưỡng sinh', 'gội đầu dưỡng sinh có tốt không', 'gội đầu dưỡng sinh giá'],
        why: bi('Dịch vụ đang bùng nổ ở VN và lượng tìm rất lớn — nhưng phần lớn tiệm chưa có trang nào nói về nó.',
                'A service booming in Vietnam with heavy search behind it — and most shops have no page about it at all.') },
      { kind: 'guide', title: bi('Đau cổ vai gáy nên massage kiểu nào', 'Neck and shoulder pain: which massage helps'),
        targets: ['đau cổ vai gáy massage', 'bấm huyệt cổ vai gáy', 'massage trị đau vai'],
        why: bi('Nhóm khách có vấn đề cụ thể — họ đặt lịch nhanh hơn nhóm tìm để thư giãn.',
                'Customers with a specific problem book faster than customers looking to relax.') },
    ],
  },
  PMU: {
    US: [
      { kind: 'guide', title: bi('Phun môi: quy trình lành và điều cần biết trước', 'Lip blush: the healing process and what to know first'),
        targets: ['lip blush healing', 'does lip blush hurt', 'how long does lip blush last'],
        why: bi('Khách sợ đau và sợ hỏng — gỡ được hai nỗi sợ đó là chốt được lịch.',
                'The fear is pain and the fear is a bad result — clear both and the appointment is booked.') },
      { kind: 'guide', title: bi('Microblading hay powder brows — hợp với ai', 'Microblading or powder brows — which suits you'),
        targets: ['microblading vs powder brows', 'powder brows oily skin', 'how long do powder brows last'],
        why: bi('Chọn sai kỹ thuật theo loại da là nguyên nhân số một của kết quả xấu — nói rõ là tạo niềm tin.',
                'Choosing the wrong technique for a skin type is the number one cause of a bad result — saying so builds trust.') },
    ],
    VN: [
      { kind: 'money', title: bi('Bảng giá phun xăm thẩm mỹ tại {city} {year}', 'Permanent makeup price list in {city}, {year}'),
        targets: ['giá phun môi', 'phun mày bao nhiêu tiền', 'bảng giá phun xăm'],
        why: bi('Khoảng giá ngành này rất rộng và khách rất sợ bị hớ — công khai giá là lợi thế cạnh tranh thật.',
                'The price range in this trade is enormous and customers are afraid of being overcharged — publishing it is a real competitive edge.') },
      { kind: 'guide', title: bi('Phun môi bao lâu lên màu, kiêng gì', 'Lip blush: colour timeline and aftercare'),
        targets: ['phun môi bao lâu lên màu', 'phun môi kiêng gì', 'phun môi có đau không'],
        why: bi('Đây là ba câu hỏi khách hỏi đi hỏi lại trong inbox. Viết một lần, dùng mãi.',
                'These are the three questions asked over and over in the inbox. Write once, reuse forever.') },
    ],
  },
  SALON: {
    US: [
      { kind: 'money', title: bi('Bảng giá dịch vụ tại {city} — {year}', 'Service prices in {city} — {year}'),
        targets: ['salon prices {city}', 'how much is a manicure', 'salon price list'],
        why: bi('Trang giá là trang gần như không ai chịu đăng, và là trang khách tìm nhiều nhất trước khi gọi.',
                'The price page is the one almost nobody publishes, and the one people look hardest for before calling.') },
      { kind: 'local', title: bi('Tiệm làm đẹp ở {city}: giờ mở cửa, đậu xe, cách đặt lịch', 'Beauty salon in {city}: hours, parking, how to book'),
        targets: ['beauty salon {city}', 'salon near me open now', 'walk in salon {city}'],
        why: bi('Ba thứ khách cần biết để bước vào cửa, mà website tiệm hay thiếu đúng ba thứ đó.',
                'The three things someone needs in order to walk in, and the three most often missing from a salon website.') },
    ],
  },
};

/**
 * The keyword map for a trade in a market.
 *
 * Falls back the way the rest of the engine does: an unknown trade gets
 * SALON, and a market with no material of its own gets the US entry rather
 * than an empty screen. An empty panel reads as "broken"; an English starter
 * list reads as "edit me", which is what it is.
 */
export function tradeKeywordsFor(industry?: string | null, market?: string | null): TradeKeywords {
  const key = String(industry ?? '').toUpperCase();
  const mk = String(market ?? '').toUpperCase();
  const vocab = VOCAB[key] ?? VOCAB.SALON;
  const topics = TOPICS[key] ?? TOPICS.SALON;
  const vn = mk === 'VN' ? vocab.VN : null;

  return {
    adGroups: vn ? adGroupsVN(vn) : adGroupsUS(vocab.US),
    seoTopics: (mk === 'VN' && topics.VN) ? topics.VN : topics.US,
  };
}

/** Fill the placeholders a template carries. An unknown placeholder is left
 *  VISIBLE rather than blanked: "{city}" on screen tells the operator
 *  something is missing; an empty gap tells them nothing. */
export function fillKeyword(
  template: string,
  vals: { city?: string | null; brand?: string | null; year?: number },
): string {
  return template
    .replace(/\{city\}/g, vals.city?.trim() || '{city}')
    .replace(/\{brand\}/g, vals.brand?.trim() || '{brand}')
    .replace(/\{year\}/g, String(vals.year ?? new Date().getFullYear()));
}
