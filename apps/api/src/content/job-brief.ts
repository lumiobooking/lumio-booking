import { bi, isBi, viOf, enOf, type Txt } from './i18n';
import type { Job, JobKind } from './weekly-plan';

/**
 * The working sheet behind each line of the week.
 *
 * WHY
 *
 * "Quay gộp 3 clip trong một buổi" is a line on a plan. It is not a thing a
 * person can do at 10am with a phone in one hand and a customer in the chair:
 * which three, how long, where does the light come from, what is the first
 * two seconds. The plan read well and nobody could execute it — that was the
 * complaint, and it was right.
 *
 * So each job carries its own sheet: the shots or steps in order, a caption
 * ready to paste, the hashtags, and where it goes. Everything in it is
 * derived from the job itself (its kind and its text) plus the little the
 * week knows about the shop, so it never disagrees with the line above it,
 * and it regenerates for free when the line changes.
 *
 * The steps double as a checklist — a person ticks them on the screen and
 * the ticks live on the week (see content.service `tickStep`).
 *
 * WHAT NEVER GOES HERE
 *
 * Nothing about where the idea came from, which feed it was read off, or why
 * this day was chosen — that is `why`/`basis`, and it stays on the team's
 * side. `steps` for the shop's own jobs are handed to the shop (client-view),
 * so they are written as craft, not method.
 */
export interface JobBrief {
  /** Shots, in order, or steps in order. Each one is a tickable line. */
  steps: Txt[];
  /** Ready-to-paste caption, for the jobs that publish something. */
  caption?: Txt;
  /** Plain tags without '#'. */
  hashtags?: string[];
  /** Where it goes: "Instagram Reels · TikTok · Facebook". */
  channel?: Txt;
}

export interface BriefContext {
  salonName?: string | null;
  city?: string | null;
  /** The trade word the playbook uses ('tiệm nail' / 'nail salon'). */
  trade?: Txt | null;
}

// ---- helpers -----------------------------------------------------------------

/** The part of a job line after its dash: "Đăng clip 1 — Mẫu X" → "Mẫu X". */
function subjectOf(text: Txt, lang: 'vi' | 'en'): string {
  const s = lang === 'vi' ? viOf(text) : enOf(text);
  const m = s.split(/\s+[—–-]\s+/);
  return (m.length > 1 ? m.slice(1).join(' — ') : s).trim();
}

/** "#austin" from "Austin, TX" — letters and digits only, lower-case. */
function cityTag(city?: string | null): string | null {
  const c = String(city ?? '').split(',')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return c.length >= 3 ? c : null;
}

const BASE_TAGS = ['nails', 'nailart', 'gelnails', 'nailsofinstagram', 'naildesign', 'nailsalon'];

function tags(ctx: BriefContext, extra: string[] = []): string[] {
  const c = cityTag(ctx.city);
  const out = [...extra, ...BASE_TAGS, ...(c ? [`${c}nails`, `${c}nailsalon`] : [])];
  return Array.from(new Set(out)).slice(0, 12);
}

const name = (ctx: BriefContext, lang: 'vi' | 'en') =>
  ctx.salonName?.trim() || (lang === 'vi' ? 'tiệm' : 'the salon');

// ---- the sheets -----------------------------------------------------------------

function filmSheet(job: Job, ctx: BriefContext): JobBrief {
  const holiday = /lễ|tết|holiday|christmas|valentine|halloween|labor|thanksgiving/i.test(viOf(job.text) + enOf(job.text));
  return {
    steps: [
      bi('Dọn góc quay: nền một màu, không đồ lặt vặt. Ánh sáng từ cửa sổ hoặc đèn ring — tắt đèn vàng trần',
        'Clear the corner: one plain background, no clutter. Window light or a ring light — turn the yellow ceiling light off'),
      bi('Điện thoại dọc (9:16), gắn giá đỡ, lau ống kính. Chạm giữ vào tay khách để khoá nét',
        'Phone upright (9:16) on a stand, lens wiped. Tap-and-hold on the hand to lock focus'),
      bi('Cảnh mở đầu (2 giây đầu): cận bộ móng HOÀN THIỆN xoay chậm dưới đèn — quay riêng, dài 5 giây',
        'Opening shot (first 2 seconds): close-up of the FINISHED set turning slowly under the light — shot on its own, 5 seconds'),
      holiday
        ? bi('Cảnh giữa: mẫu theo mùa lễ — 3 cảnh, mỗi cảnh 5–8 giây: màu/hoạ tiết chủ đề, tay thợ vẽ chi tiết, sản phẩm dùng',
          'Middle: the seasonal design — 3 shots of 5–8 seconds: the theme colour/pattern, the tech painting the detail, the products used')
        : bi('Cảnh giữa: 3 cảnh quy trình, mỗi cảnh 5–8 giây — dũa/tạo form, sơn/đắp, vẽ chi tiết. Tay thợ trong khung',
          'Middle: 3 process shots of 5–8 seconds — filing/shaping, painting/building, detail work. The tech\'s hands in frame'),
      bi('Cảnh kết: khách xoay tay ngắm + cười, 4 giây. Quay thêm 1 lần dự phòng',
        'Closing shot: the client turning her hand, smiling, 4 seconds. Take one spare'),
      bi('Không cần nhạc, không cần chữ — team dựng. Gửi bản gốc qua nút "Đã quay xong" (Zalo/Messenger làm nát hình)',
        'No music, no text — the team edits. Send the originals with the "Filmed it" button (Zalo/Messenger crush the quality)'),
    ],
    channel: bi('Kho clip của tuần — team cắt thành Reels/TikTok', 'The week\'s clip bank — the team cuts Reels/TikTok from it'),
  };
}

function photoSheet(): JobBrief {
  return {
    steps: [
      bi('Ảnh 1 — TRƯỚC: móng cũ lúc khách vừa ngồi xuống, chụp thẳng từ trên', 'Photo 1 — BEFORE: the old set as the client sits down, straight from above'),
      bi('Ảnh 2 — SAU: bộ vừa xong, cùng góc, cùng ánh sáng với ảnh 1', 'Photo 2 — AFTER: the finished set, same angle, same light as photo 1'),
      bi('Ảnh 3 — cận 1 ngón: chi tiết đẹp nhất, góc 45°, nét vào móng', 'Photo 3 — one-nail close-up: the best detail, 45°, focus on the nail'),
      bi('Ảnh 4 — đời thường: tay cầm ly cà phê / túi / điện thoại', 'Photo 4 — lifestyle: the hand holding a coffee, a bag, a phone'),
      bi('Ảnh 5 — phản ứng khách khi nhìn tay (chụp liên tiếp, lấy tấm tự nhiên nhất)', 'Photo 5 — the client\'s reaction seeing her hands (burst mode, keep the natural one)'),
      bi('Ảnh 6 — sản phẩm hoặc bảng giá dịch vụ vừa làm', 'Photo 6 — the product or the price of what was just done'),
      bi('Chung: sáng cửa sổ, nền trơn, không zoom số, không filter — team chỉnh màu', 'All: window light, plain background, no digital zoom, no filter — the team grades the colour'),
    ],
    channel: bi('Kho ảnh của tuần — bộ ảnh, hồ sơ Google, story', 'The week\'s photo bank — carousels, Google profile, stories'),
  };
}

function postSheet(job: Job, ctx: BriefContext): JobBrief {
  const isPhotoSet = /bộ ảnh|photo set|carousel/i.test(viOf(job.text) + enOf(job.text));
  const subjVi = subjectOf(job.text, 'vi');
  const subjEn = subjectOf(job.text, 'en');
  const nVi = name(ctx, 'vi'); const nEn = name(ctx, 'en');
  return {
    steps: isPhotoSet
      ? [
        bi('Chọn 4–6 ảnh từ buổi chụp — ảnh SAU đẹp nhất để đầu, ảnh TRƯỚC để thứ 2 (người xem sẽ vuốt)',
          'Pick 4–6 photos from the shoot — best AFTER first, BEFORE second (people swipe to see)'),
        bi('Cắt về 4:5, cùng tông màu cả bộ', 'Crop to 4:5, one colour tone across the set'),
        bi('Dán caption bên dưới, đổi tên mẫu/giá cho đúng', 'Paste the caption below, fix the design name/price'),
        bi('Đăng Instagram + Facebook cùng lúc, đúng khung giờ ghi trên việc', 'Post to Instagram + Facebook together, in the time window on the job'),
        bi('Ghim bình luận đầu tiên có link đặt lịch', 'Pin the first comment with the booking link'),
        bi('Trả lời mọi bình luận trong 30 phút đầu', 'Answer every comment in the first 30 minutes'),
      ]
      : [
        bi('Chọn đúng clip số ghi trên việc. Cắt 15–30 giây; 2 giây đầu = cận bộ móng xoay',
          'Pick the clip number on the job. Cut to 15–30 seconds; first 2 seconds = the set turning'),
        bi('Một dòng chữ nổi ở giây 1–3 (tên mẫu hoặc câu hỏi), nhạc trending không lời',
          'One text line at seconds 1–3 (design name or a question), trending instrumental audio'),
        bi('Dán caption bên dưới, đổi tên mẫu/giá cho đúng', 'Paste the caption below, fix the design name/price'),
        bi('Đăng Instagram Reels + TikTok + Facebook Reels cùng lúc, đúng khung giờ ghi trên việc',
          'Post Instagram Reels + TikTok + Facebook Reels together, in the time window on the job'),
        bi('Ghim bình luận đầu tiên có link đặt lịch', 'Pin the first comment with the booking link'),
        bi('Trả lời mọi bình luận trong 30 phút đầu — thuật toán đẩy bài có trả lời',
          'Answer every comment in the first 30 minutes — replies are what the algorithm pushes'),
      ],
    caption: bi(
      `${subjVi} 💅 tại ${nVi}.\nNhìn kỹ giây thứ 3 nhé — chi tiết này làm tay 40 phút.\n\nĐặt lịch: link trong bio · chọn giờ, chọn thợ, 30 giây là xong.\nHỏi giá: nhắn "GIÁ" ở dưới, em trả lời liền.`,
      `${subjEn} 💅 at ${nEn}.\nWatch second 3 — that detail is 40 minutes of handwork.\n\nBook: link in bio · pick a time, pick your tech, done in 30 seconds.\nPrice? Comment "PRICE" and we\'ll reply.`),
    hashtags: tags(ctx, isPhotoSet ? ['nailinspo', 'beforeandafter'] : ['nailsreels', 'nailtok']),
    channel: isPhotoSet
      ? bi('Instagram (bộ ảnh) · Facebook', 'Instagram carousel · Facebook')
      : bi('Instagram Reels · TikTok · Facebook Reels', 'Instagram Reels · TikTok · Facebook Reels'),
  };
}

function storySheet(job: Job): JobBrief {
  const countdown = /đếm ngược|countdown/i.test(viOf(job.text) + enOf(job.text));
  return {
    steps: countdown
      ? [
        bi('Khung 1: ảnh bộ móng đẹp nhất + chữ to "Còn hôm nay" + sticker đếm ngược tới giờ đóng cửa',
          'Frame 1: the best set + big text "Last day" + countdown sticker to closing time'),
        bi('Khung 2: nhắc lại ưu đãi đúng 1 dòng (%, khung giờ) + sticker "Nhắn tin"',
          'Frame 2: the offer in one line (%, time slot) + a "Send message" sticker'),
        bi('Đăng 8–9h sáng ngày cuối. Trả lời tin nhắn trong 10 phút', 'Post 8–9am on the last day. Answer messages within 10 minutes'),
      ]
      : [
        bi('Khung 1: góc quay đang set (giá đỡ, đèn) — "Hôm nay quay gì đây?"', 'Frame 1: the corner being set up (stand, light) — "Guess what we\'re filming?"'),
        bi('Khung 2: tay thợ đang làm, 5 giây, không chữ', 'Frame 2: the tech\'s hands at work, 5 seconds, no text'),
        bi('Khung 3: sticker bình chọn — "Mẫu A hay B?"', 'Frame 3: poll sticker — "Design A or B?"'),
        bi('Khung 4: kết quả gần xong + "Bài đầy đủ tối nay 👀"', 'Frame 4: nearly done + "Full post tonight 👀"'),
      ],
    channel: bi('Instagram Story · Facebook Story', 'Instagram Story · Facebook Story'),
  };
}

function engageSheet(): JobBrief {
  return {
    steps: [
      bi('15 phút, đặt đồng hồ. Trả lời hết bình luận và tin nhắn còn tồn — kể cả chỉ một emoji',
        '15 minutes, on a timer. Clear every comment and message — even with just an emoji'),
      bi('Thả tim + bình luận thật (1 câu) lên 10 bài của khách/tiệm lân cận trong thành phố',
        'Like + one real sentence on 10 posts by customers/nearby businesses in town'),
      bi('Trả lời câu hỏi mới trên hồ sơ Google (mục Hỏi & Đáp)', 'Answer any new question on the Google profile (Q&A)'),
      bi('Lưu 2 bình luận hay nhất — dùng làm caption tuần sau', 'Save the 2 best comments — next week\'s captions'),
    ],
    channel: bi('Instagram · Facebook · Google', 'Instagram · Facebook · Google'),
  };
}

function gbpSheet(job: Job, ctx: BriefContext): JobBrief {
  const check = /kiểm tra|check|giờ mở cửa|hours|bảng giá|prices/i.test(viOf(job.text) + enOf(job.text));
  const nVi = name(ctx, 'vi'); const nEn = name(ctx, 'en');
  return {
    steps: check
      ? [
        bi('Mở Google Business Profile → xem giờ mở cửa đúng chưa, ngày lễ sắp tới có ghi giờ riêng chưa',
          'Open Google Business Profile → check the hours, and that the coming holiday has its own hours'),
        bi('Ảnh: ảnh bìa là bộ móng đẹp nhất tháng? Xoá ảnh mờ/cũ. Thêm 3 ảnh mới từ buổi chụp',
          'Photos: is the cover the best set of the month? Remove blurry/old ones. Add 3 new from the shoot'),
        bi('Dịch vụ & giá: khớp bảng giá trong tiệm', 'Services & prices: match the in-store menu'),
        bi('Trả lời mọi đánh giá chưa trả lời — 1–2 câu, gọi tên khách', 'Reply to every unanswered review — 1–2 sentences, use the customer\'s name'),
      ]
      : [
        bi('Google Business Profile → "Thêm bài cập nhật"', 'Google Business Profile → "Add update"'),
        bi('1 ảnh SAU đẹp nhất (ngang hoặc vuông)', 'One best AFTER photo (landscape or square)'),
        bi('Dán 2 câu bên dưới, thêm nút "Đặt lịch" với link đặt lịch của tiệm', 'Paste the 2 sentences below, add a "Book" button with the salon\'s booking link'),
        bi('Đăng — bài Google hết hạn sau 7 ngày, nên mỗi tuần 1 bài', 'Publish — Google posts expire after 7 days, so one per week'),
      ],
    caption: check ? undefined : bi(
      `Bộ móng tuần này tại ${nVi}. Đặt lịch online 24/7 — chọn giờ và thợ, xác nhận ngay.`,
      `This week\'s set at ${nEn}. Book online 24/7 — pick your time and tech, confirmed instantly.`),
    channel: bi('Hồ sơ Google (Maps)', 'Google Business Profile (Maps)'),
  };
}

function winbackSheet(ctx: BriefContext): JobBrief {
  const nVi = name(ctx, 'vi'); const nEn = name(ctx, 'en');
  return {
    steps: [
      bi('Mở Khách hàng → lọc "lâu chưa quay lại" → chọn 10 người đã đến ≥2 lần', 'Open Customers → filter "not back in a while" → pick 10 who came ≥2 times'),
      bi('Nhắn TAY từng người, gọi đúng tên, nhắc dịch vụ lần trước (xem lịch sử)', 'Text each one BY HAND, by name, mention their last service (check the history)'),
      bi('Dùng mẫu tin bên dưới — đổi tên và ngày. Không gửi hàng loạt', 'Use the template below — change the name and the day. No bulk send'),
      bi('Ai trả lời → giữ chỗ ngay trong tin nhắn, ghi vào lịch', 'Whoever replies → hold the slot in the thread, put it on the book'),
    ],
    caption: bi(
      `Chào chị [Tên], lâu rồi không thấy chị ghé ${nVi}! Lần trước chị làm [dịch vụ], em còn nhớ. Tuần này [thứ] còn trống buổi [sáng/chiều] — em giữ chỗ cho chị nhé? — [Tên thợ]`,
      `Hi [Name], it\'s been a while since we saw you at ${nEn}! Last time you had [service] — I remember. This [day] we have [morning/afternoon] open — want me to hold it for you? — [Tech name]`),
    channel: bi('SMS / Zalo / Messenger — tin riêng', 'SMS / Messenger — direct message'),
  };
}

function eventSheet(): JobBrief {
  return {
    steps: [
      bi('Chọn 1 đối tác trong bán kính 1km: tiệm tóc, mi, spa, quán cà phê', 'Pick one partner within 1km: hair, lashes, spa, a café'),
      bi('Đề nghị đơn giản: khách bên họ được [quà nhỏ] ở mình, và ngược lại. In 30 thẻ',
        'Keep the offer simple: their customers get [a small extra] with us, and vice versa. Print 30 cards'),
      bi('Chụp 1 ảnh chung 2 chủ tiệm — đăng cả 2 trang, tag nhau', 'One photo of both owners — post on both pages, tag each other'),
      bi('Ghi ngày bắt đầu và ngày xem lại (4 tuần)', 'Note the start date and a review date (4 weeks)'),
    ],
    channel: bi('Tại tiệm · Instagram · Facebook', 'In store · Instagram · Facebook'),
  };
}

/**
 * The offer, as a sheet — built from the same numbers the offer line was
 * built from, so the caption can never promise a different percentage than
 * the plan. Called from weekly-plan with what it knows; also from the offer
 * form (week-offer) for a custom one.
 */
export function offerSheet(o: {
  headline: Txt;          // "12% CHỈ Thứ 7 buổi sáng" / "12% off Saturday morning ONLY"
  rules: Txt;             // one line of conditions
  expires?: string | null;
}, ctx: BriefContext): JobBrief {
  const nVi = name(ctx, 'vi'); const nEn = name(ctx, 'en');
  const exp = o.expires ? ` Hết hạn ${o.expires}.` : '';
  const expEn = o.expires ? ` Ends ${o.expires}.` : '';
  return {
    steps: [
      bi('Ảnh: 1 bộ móng đẹp nhất + chữ TO ghi đúng ưu đãi (con số, khung giờ). Không quá 8 chữ trên ảnh',
        'Image: one best set + BIG text with the exact offer (number, time slot). No more than 8 words on the image'),
      bi('Dán caption bên dưới — điều kiện ghi rõ, có hạn chót', 'Paste the caption below — conditions spelled out, with a deadline'),
      bi('Đăng Facebook + Instagram, đúng giờ ghi trên việc', 'Post Facebook + Instagram, at the time on the job'),
      bi('Ghim bài lên đầu trang Facebook. Cài trả lời tự động Messenger nhắc đúng ưu đãi này',
        'Pin it to the top of the Facebook page. Set the Messenger auto-reply to mention this exact offer'),
      bi('Đăng cùng nội dung lên hồ sơ Google với nút "Đặt lịch"', 'Same content on the Google profile with a "Book" button'),
      bi('Sáng ngày cuối: story đếm ngược (đã có trong lịch)', 'Morning of the last day: countdown story (already on the plan)'),
    ],
    caption: bi(
      `🎉 ${viOf(o.headline)} tại ${nVi}!\n${viOf(o.rules)}${exp}\n\nĐặt lịch: link trong bio — chọn giờ, chọn thợ, xác nhận ngay.\nSố chỗ có hạn, hết là hết 💅`,
      `🎉 ${enOf(o.headline)} at ${nEn}!\n${enOf(o.rules)}${expEn}\n\nBook: link in bio — pick a time, pick your tech, confirmed instantly.\nLimited spots 💅`),
    hashtags: tags(ctx, ['nailsdeal', 'nailspecial']),
    channel: bi('Facebook (ghim) · Instagram · Hồ sơ Google', 'Facebook (pinned) · Instagram · Google profile'),
  };
}

// ---- entry ---------------------------------------------------------------------

/** The sheet for a job that does not carry one yet. `rest` gets none. */
export function briefFor(job: Job, ctx: BriefContext): JobBrief | null {
  switch (job.kind as JobKind) {
    case 'film': return filmSheet(job, ctx);
    case 'photo': return photoSheet();
    case 'post': return postSheet(job, ctx);
    case 'story': return storySheet(job);
    case 'engage': return engageSheet();
    case 'gbp': return gbpSheet(job, ctx);
    case 'winback': return winbackSheet(ctx);
    case 'event': return eventSheet();
    case 'offer': return job.brief ?? null; // built with its numbers in weekly-plan
    default: return null;
  }
}

/**
 * A stable id for a job, so a tick on Tuesday still points at the same line
 * after the week regenerates on Wednesday. Hashed from what the job IS (kind
 * + Vietnamese text), so rewording it makes a new job — which is correct: the
 * old ticks were for the old instruction.
 */
export function jobId(job: Pick<Job, 'kind' | 'text'>): string {
  const s = `${job.kind}|${isBi(job.text) ? job.text.vi : String(job.text)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/** Give every job in the week an id and a sheet. Ids are made unique per week. */
export function attachBriefs<D extends { jobs: Job[] }>(days: D[], ctx: BriefContext): D[] {
  const seen = new Map<string, number>();
  return days.map((d) => ({
    ...d,
    jobs: d.jobs.map((j) => {
      if (j.kind === 'rest') return j;
      let id = j.id ?? jobId(j);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n > 0) id = `${id}-${n}`;
      return { ...j, id, brief: j.brief ?? briefFor(j, ctx) ?? undefined };
    }),
  }));
}
