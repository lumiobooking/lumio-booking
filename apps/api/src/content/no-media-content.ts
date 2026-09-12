import { bi, viOf, type Txt } from './i18n';
import type { Job } from './weekly-plan';

/**
 * WORK THAT SHIPS IN A WEEK THE SHOP SENDS NOTHING.
 *
 * THE RISK THIS EXISTS TO COVER, STATED PLAINLY
 *
 * Lumio is a remote agency. The raw material — a clip of a hand, a photo of a
 * finished set — lives in a room in another country, in the hands of an owner
 * who is running a salon and was promised she would barely have to do anything.
 * She will not send every week. That is not a failure of hers to be chased out
 * of existence; it is a property of the business model, and a plan that stalls
 * the moment it happens is a plan that stalls regularly.
 *
 * Until now every publishing job started with "pick the clip" or "pick 4–6
 * photos". No footage, no week. The crew board now says so out loud (see the
 * waiting lane in crew-board.ts) — which made the hole visible and did nothing
 * about it.
 *
 * WHAT THESE JOBS ARE MADE OF
 *
 * Only things already in our hands on Monday morning:
 *   - the photo bank: everything the shop has ever sent;
 *   - its Google reviews, which are words a customer wrote;
 *   - its own price list;
 *   - where it is, and what month it is.
 *
 * None of them needs the shop to do anything at all. They are not a
 * consolation prize either — a five-star review in the customer's own words
 * outperforms most things a salon posts, and it costs nothing to produce.
 *
 * WHAT THIS IS NOT
 *
 * Not a replacement for filming. A week built entirely from the bank gets
 * thinner every month, so these are a floor, not a ceiling: two jobs at most,
 * and the ask for real footage goes out exactly as before.
 */

export interface BankContext {
  /** How many pieces of media the shop has EVER sent us. */
  bankItems: number;
  /** Reviews we hold, best first. Only the text is used. */
  reviews: { stars: number; text: string; author?: string | null }[];
  /** The price list — a card of three services is a post on its own. */
  menu: { name: string; priceCents: number }[];
  city?: string | null;
  /** Rotates the pick so a salon does not get the same one twice running. */
  week: number;
}

/** Never more than this, however much material we hold. See the header. */
export const MAX_NO_MEDIA = 2;

const fmt = (c: number) => `$${Math.round(c / 100)}`;

type Candidate = { job: Job; rank: number };

/**
 * Jobs that need nothing new from the salon.
 *
 * Ordered by how well they actually perform, not by how easy they are: a real
 * customer's words first, then the shop's own past work, then a price card,
 * then the area post. Returns an empty list when we hold nothing — inventing a
 * job out of no material is how a plan starts lying.
 */
export function noMediaJobs(ctx: BankContext): Job[] {
  const out: Candidate[] = [];
  const wk = Math.max(0, Math.round(ctx.week || 0));

  const best = (ctx.reviews ?? []).filter((r) => r && r.stars >= 5 && String(r.text ?? '').trim().length >= 40)[0];
  if (best) {
    const words = String(best.text).trim().replace(/\s+/g, ' ').slice(0, 90);
    out.push({
      rank: 0,
      job: {
        kind: 'post',
        fromBank: true,
        text: bi(
          `Đăng lại đánh giá 5 sao — làm thành ảnh chữ, trích "${words}…"`,
          `Repost the 5-star review as a text card — pull the line "${words}…"`),
        why: bi(
          'Lời khách nói mạnh hơn mọi câu tiệm tự viết, và bài này không cần tiệm gửi thêm gì — chữ đã có sẵn trên hồ sơ Google.',
          'A customer\'s own words beat anything the shop writes about itself, and this one needs nothing new from the shop — the words are already on the Google profile.'),
        brief: {
          steps: [
            bi('Chép nguyên văn câu hay nhất — không sửa chính tả của khách', 'Copy the best line exactly — do not fix the customer\'s spelling'),
            bi('Nền một màu của tiệm, chữ to, 5 ngôi sao ở trên', 'One brand colour, big type, five stars above it'),
            bi('Ghi tên khách bằng tên + chữ cái đầu họ. Không đăng ảnh mặt khách.', 'Name her by first name and last initial. No face.'),
            bi('Ghim bình luận đầu tiên có link đặt lịch', 'Pin a first comment with the booking link'),
          ],
          channel: bi('Instagram · Facebook', 'Instagram · Facebook'),
        },
      },
    });
  }

  if ((ctx.bankItems ?? 0) > 0) {
    out.push({
      rank: 1,
      job: {
        kind: 'post',
        fromBank: true,
        text: bi(
          'Dựng lại 1 bài từ kho ảnh cũ — cắt khác, caption khác, góc khác',
          'Rebuild one post from the photo bank — new crop, new caption, new angle'),
        why: bi(
          'Kho ảnh của tiệm đã trả tiền rồi mà mỗi tấm chỉ dùng một lần. Người theo dõi hôm nay phần lớn chưa từng thấy bài ba tháng trước.',
          'The bank is already paid for and every shot has been used once. Most of today\'s followers never saw what went out three months ago.'),
        brief: {
          steps: [
            bi('Chọn bài cũ chạy tốt nhất còn trong kho, ít nhất 8 tuần trước', 'Pick the best-performing old set in the bank, at least 8 weeks old'),
            bi('Cắt khác hẳn lần trước — cận hơn, hoặc đổi tỉ lệ', 'Crop it differently — closer, or a different ratio'),
            bi('Caption mới hoàn toàn, góc nhìn khác. Không dán lại caption cũ.', 'A completely new caption from a different angle. Never re-paste the old one.'),
          ],
          channel: bi('Instagram · Facebook', 'Instagram · Facebook'),
        },
      },
    });
  }

  const priced = (ctx.menu ?? []).filter((m) => m && m.priceCents > 0).slice(0, 3);
  if (priced.length >= 2) {
    out.push({
      rank: 2,
      job: {
        kind: 'post',
        fromBank: true,
        text: bi(
          `Card bảng giá: ${priced.map((m) => `${m.name} ${fmt(m.priceCents)}`).join(' · ')}`,
          `Price card: ${priced.map((m) => `${m.name} ${fmt(m.priceCents)}`).join(' · ')}`),
        why: bi(
          'Câu người lạ hỏi nhiều nhất trong inbox là giá. Trả lời trước khi họ phải hỏi thì bớt được một bước trước lúc đặt lịch — và bài này chỉ cần bảng giá tiệm đã khai.',
          'Price is the most common question a stranger sends. Answering it before they ask removes a step before booking — and this post needs only the price list already on file.'),
        brief: {
          steps: [
            bi('Ba dịch vụ, ba giá, nền một màu. Không nhồi cả bảng giá vào một ảnh.', 'Three services, three prices, one flat colour. Never the whole menu in one image.'),
            bi('Ghi rõ giá đã gồm gì — "gồm tháo bộ cũ" cắt được nửa số câu hỏi', 'Say what the price includes — "removal included" kills half the questions'),
            bi('Kết bằng lời mời đặt lịch, kèm link', 'End with an invitation to book, and the link'),
          ],
          channel: bi('Instagram · Facebook · Hồ sơ Google', 'Instagram · Facebook · Google profile'),
        },
      },
    });
  }

  const city = String(ctx.city ?? '').trim();
  if (city && (ctx.bankItems ?? 0) > 0) {
    out.push({
      rank: 3,
      job: {
        kind: 'post',
        fromBank: true,
        text: bi(
          `Bài địa phương: "Làm nail ở ${city}" — ảnh kho + 3 câu về khu vực`,
          `Local post: "Getting your nails done in ${city}" — a bank photo and three lines about the area`),
        why: bi(
          `Người tìm tiệm gõ kèm tên khu. Một bài có chữ ${city} trong đó là một bài Google đọc được, và nó không tốn của tiệm một phút nào.`,
          `People search with the area name in the query. A post with ${city} in it is a post Google can read, and it costs the shop nothing.`),
        brief: {
          steps: [
            bi(`Nhắc tên ${city} và một mốc gần tiệm — đường lớn, trung tâm thương mại`, `Name ${city} and one landmark — the main street, the mall`),
            bi('Một ảnh từ kho, ưu tiên ảnh có mặt tiền hoặc bên trong tiệm', 'One photo from the bank, ideally the storefront or the room'),
            bi('Kết bằng giờ mở cửa và link đặt lịch', 'End with the opening hours and the booking link'),
          ],
          channel: bi('Hồ sơ Google · Facebook', 'Google profile · Facebook'),
        },
      },
    });
  }

  if (!out.length) return [];
  // Rotate the entry point by week so a salon does not get the same job every
  // Monday, but keep the ranking: the review card is the best of these and
  // leads whenever there is one to lead with.
  const ordered = [...out].sort((a, b) => a.rank - b.rank).map((c) => c.job);
  const start = ordered.length > MAX_NO_MEDIA ? wk % ordered.length : 0;
  const rotated = [...ordered.slice(start), ...ordered.slice(0, start)];
  return rotated.slice(0, MAX_NO_MEDIA);
}

/** For the team's brief: what this week can still ship if nothing arrives. */
export function noMediaNote(jobs: Job[]): Txt | null {
  if (!jobs.length) return null;
  return bi(
    `Tuần này có ${jobs.length} bài không cần tiệm gửi gì: ${jobs.map((j) => viOf(j.text).split('—')[0].trim()).join(' · ')}.`,
    `${jobs.length} posts this week need nothing from the shop.`);
}
