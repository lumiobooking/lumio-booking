/**
 * The three anchors that keep a daily AI plan from drifting into sameness:
 * the SEASON (what design customers are about to want), today's PILLAR
 * (which of the trade's post angles today belongs to), and the live TRENDS
 * (what is actually moving this week, pulled by the trend feed).
 *
 * All pure: the service fetches, this file phrases. Every prompt block is
 * Vietnamese because the whole prompt library is (see content.service), and
 * everything shown to a salon goes through bi() like the rest of the module.
 *
 * WHY SEASONS ARE HARD-CODED AND NOT ASKED OF THE MODEL
 *
 * Nail design is a calendar business: chrome french in September and
 * candy-cane tips in December are not taste, they are inventory planning —
 * the salon buys colors and drills designs WEEKS ahead. A model asked "what
 * season is it" will answer correctly; a model asked for ideas without being
 * told will happily suggest beach neon in November. The calendar is small,
 * stable, and checkable, so it lives here as data.
 */

import { bi, viOf, type Txt } from './i18n';
import type { Playbook, PostType } from './industry-playbook';

export interface NailSeason {
  /** The month's theme, shown to the salon and fed to the prompt. */
  theme: Txt;
  /** Design/color keywords in ENGLISH — captions and hashtags use them raw. */
  designs: string[];
  /** What the salon should be preparing for NEXT month — the buy-ahead line. */
  prep: Txt;
}

/** month is 1-12. US market calendar; the events module covers the holidays themselves. */
const NAIL_SEASONS: Record<number, NailSeason> = {
  1: { theme: bi('Đầu năm tối giản — móng "sạch", màu sữa, nude', 'New-year reset — clean girl nails, milky white, nude'), designs: ['milky white', 'clean girl nails', 'nude minimalist', 'glazed donut'], prep: bi('Chuẩn bị đỏ hồng cho Valentine', 'Stock reds and pinks for Valentine\'s') },
  2: { theme: bi('Valentine — đỏ, hồng, trái tim, chrome hồng', 'Valentine\'s — reds, pinks, hearts, pink chrome'), designs: ['valentines nails', 'red chrome', 'pink french tips', 'heart nail art'], prep: bi('Pastel mùa xuân lên kệ cuối tháng', 'Spring pastels go up late this month') },
  3: { theme: bi('Xuân — pastel, hoa nhí, xanh mint', 'Spring — pastels, tiny florals, mint'), designs: ['spring pastel nails', 'floral nail art', 'mint green nails', 'lavender nails'], prep: bi('Hoa và màu trứng cho lễ Phục sinh', 'Florals and egg-shell shades for Easter') },
  4: { theme: bi('Phục sinh & prom — pastel ngọt, lấp lánh nhẹ', 'Easter & prom — soft pastels, light shimmer'), designs: ['easter nails', 'prom nails', 'pearl nails', 'baby pink french'], prep: bi('Mùa cưới và Mother\'s Day tới gần — chuẩn bị mẫu sang trọng', 'Wedding season and Mother\'s Day are close — prep elegant sets') },
  5: { theme: bi('Mother\'s Day & mùa cưới — thanh lịch, french, nhũ ngọc', 'Mother\'s Day & weddings — elegant, french, pearl shimmer'), designs: ['wedding nails', 'bridal french', 'mothers day nails', 'elegant almond nails'], prep: bi('Neon và màu nhiệt đới cho hè', 'Neon and tropical shades for summer') },
  6: { theme: bi('Hè — neon, nhiệt đới, móng chân rực rỡ', 'Summer — neon, tropical, bright pedicures'), designs: ['summer neon nails', 'tropical nail art', 'bright pedicure', 'ocean blue nails'], prep: bi('Khách đi biển tháng 7 — đẩy combo tay + chân', 'July is vacation month — push mani-pedi combos') },
  7: { theme: bi('Cao điểm du lịch — màu rực, aura, tie-dye', 'Peak vacation — vivid colors, aura nails, tie-dye'), designs: ['vacation nails', 'aura nails', 'sunset ombre', 'neon french tips'], prep: bi('Back-to-school cuối tháng 8 — mẫu gọn, bền', 'Back-to-school hits late August — prep tidy, durable sets') },
  8: { theme: bi('Back-to-school — glazed, chrome nhẹ, màu gọn gàng bền', 'Back-to-school — glazed, soft chrome, tidy long-wear colors'), designs: ['back to school nails', 'glazed nails', 'soft chrome', 'short square nails'], prep: bi('Thu tới: cam cháy, nâu, vàng đồng lên kệ', 'Fall is next: burnt orange, browns, copper go up') },
  9: { theme: bi('Chớm thu — cam cháy, nâu latte, chrome vàng đồng', 'Early fall — burnt orange, latte browns, copper chrome'), designs: ['fall nails', 'burnt orange nails', 'latte nails', 'copper chrome french'], prep: bi('Halloween tháng sau — mẫu nhện, máu, đen đỏ', 'Halloween next month — spiders, drips, black-and-red sets') },
  10: { theme: bi('Halloween — đen, đỏ máu, nhện, mắt mèo ma mị', 'Halloween — black, blood red, spider webs, moody cat-eye'), designs: ['halloween nails', 'spider web nails', 'black cat eye nails', 'blood drip nails'], prep: bi('Thu sâu & Lễ Tạ ơn: nâu trầm, vàng đồng, nhũ', 'Deep fall & Thanksgiving: deep browns, gold, shimmer') },
  11: { theme: bi('Tạ ơn — nâu trầm, đỏ rượu, vàng đồng sang', 'Thanksgiving — deep browns, wine red, warm gold'), designs: ['thanksgiving nails', 'burgundy nails', 'gold foil nails', 'tortoiseshell nails'], prep: bi('Giáng sinh là tháng ĐÔNG NHẤT NĂM — đặt lịch sớm, mẫu lấp lánh', 'December is the BUSIEST month of the year — pre-book now, stock glitter') },
  12: { theme: bi('Giáng sinh & giao thừa — đỏ, nhũ bạc, kẹo gậy, lấp lánh', 'Christmas & NYE — reds, silver glitter, candy cane, full sparkle'), designs: ['christmas nails', 'candy cane french', 'glitter new years nails', 'red velvet nails'], prep: bi('Tháng 1 khách chuyển về tối giản — đừng ôm kho nhũ', 'January swings minimalist — don\'t overstock glitter') },
};

/** The month's design season — SALON only; other trades lean on the events module. */
export function seasonFor(industry: string | null | undefined, month: number): NailSeason | null {
  if (String(industry ?? '').toUpperCase() !== 'SALON') return null;
  return NAIL_SEASONS[month] ?? null;
}

export function seasonToPrompt(season: NailSeason | null, month: number): string {
  if (!season) return '';
  return `MÙA THIẾT KẾ THÁNG ${month} (lịch ngành nail Mỹ — ý tưởng và caption nên thuận theo):\n`
    + `- Chủ đề: ${viOf(season.theme)}\n`
    + `- Từ khóa mẫu đang mùa (dùng thẳng trong caption/hashtag tiếng Anh): ${season.designs.join(', ')}\n`
    + `- Chuẩn bị trước: ${viOf(season.prep)}`;
}

/**
 * Which of the trade's post angles today belongs to. Rotating by the day
 * keeps five straight days from being five before-and-afters — the model was
 * asked not to repeat itself, but an instruction is a hope and a rotation is
 * a guarantee.
 */
export function pillarFor(book: Playbook, dayKey: string): PostType {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dayIndex = Math.floor(Date.UTC(y || 1970, (m || 1) - 1, d || 1) / 86_400_000);
  const list = book.postTypes;
  return list[((dayIndex % list.length) + list.length) % list.length];
}

export function pillarToPrompt(pillar: PostType): string {
  return `TRỤ NỘI DUNG HÔM NAY (bắt buộc cho Ý 1): "${viOf(pillar.label)}" — ${viOf(pillar.job)}\n`
    + `Cảnh gợi ý của trụ này: ${viOf(pillar.shots)}\n`
    + `Ý 2 và Ý 3 được tự do chọn trụ khác để một tuần phủ đủ các góc.`;
}

/** One live trend, as the feed stored it. Only what the prompt needs. */
export interface TrendForPrompt {
  title: string;
  source: string;
  perDay?: number | null;
  thumbUrl?: string | null;
  url?: string | null;
}

export interface RisingForPrompt { query: string; growthPct?: number | null; source: string }

/**
 * The live-trend block. The rule that matters: the model may ADAPT a listed
 * trend and must then copy its exact title into "trendTitle" — that is how
 * the idea card later shows the reference clip. Inventing a trend that is
 * not on the list is forbidden; better no trend than a made-up one.
 */
export function trendsToPrompt(items: TrendForPrompt[], rising: RisingForPrompt[]): string {
  if (!items.length && !rising.length) return '';
  const lines: string[] = ['ĐANG XU HƯỚNG TRONG NGÀNH (hệ thống kéo tự động hôm nay):'];
  for (const t of items.slice(0, 5)) {
    lines.push(`- [${t.source}] "${t.title}"${t.perDay ? ` — ~${Math.round(t.perDay).toLocaleString('en-US')} lượt xem/ngày` : ''}`);
  }
  if (rising.length) {
    lines.push('Từ khóa đang tăng: ' + rising.slice(0, 8).map((r) => `"${r.query}"${r.growthPct != null ? ` (+${r.growthPct}%)` : ''}`).join(', '));
  }
  lines.push('Nếu một trend ở trên hợp với tiệm, Ý 1 nên PHỎNG THEO nó theo chất riêng của tiệm và ghi ĐÚNG NGUYÊN VĂN tiêu đề trend vào trường "trendTitle". Không hợp thì bỏ trống trendTitle. TUYỆT ĐỐI không bịa trend ngoài danh sách.');
  return lines.join('\n');
}
