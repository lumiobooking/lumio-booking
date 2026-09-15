/**
 * THE BUTTON ON A GOOGLE BUSINESS PROFILE POST.
 *
 * WHAT WENT WRONG
 *
 * Every Google post left here with a hard-wired "Book" button and one URL the
 * code chose. The person writing the post had no say: not which button, not
 * where it pointed. And Google's rule for a Book button is absolute — it must
 * carry a link — so a shop whose booking page could not be resolved produced
 * a post Google refused with "A link is required for this button", which the
 * scheduler reported as a failed run hours after anyone was looking.
 *
 * WHAT THIS DOES INSTEAD
 *
 * The button is a decision the writer makes on the post, stored with the
 * post, and resolved here into exactly what Google's API accepts:
 *
 *   book   → BOOK + a link. The shop's own booking page by default, editable.
 *   call   → CALL, and NO link: Google dials the phone on the profile itself.
 *   learn  → LEARN_MORE + a link: the website, or the booking page failing that.
 *   none   → no button.
 *
 * Two rules the resolver will not bend: a Book or Learn-more button never
 * leaves here without a valid https link (it downgrades to no button and says
 * why, at write time, while the writer is still looking), and a Call button
 * never carries a link (Google rejects the pair).
 */

export type GbpButton = 'book' | 'call' | 'learn' | 'none';

export interface GbpPostOptions {
  button: GbpButton;
  /** The writer's own link, when they typed one. Null means "use the default". */
  url: string | null;
}

/** What the composer starts from when the post has never said. */
export const DEFAULT_GBP_BUTTON: GbpButton = 'book';

export const GBP_BUTTONS: GbpButton[] = ['book', 'call', 'learn', 'none'];

export const GBP_BUTTON_LABEL: Record<GbpButton, { vi: string; en: string }> = {
  book: { vi: 'Đặt lịch', en: 'Book' },
  call: { vi: 'Gọi ngay', en: 'Call now' },
  learn: { vi: 'Tìm hiểu thêm', en: 'Learn more' },
  none: { vi: 'Không có nút', en: 'No button' },
};

/** A link Google will accept on a button: absolute https, no spaces, sane length. */
export function usableCtaUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || u.length > 2048 || /\s/.test(u)) return false;
  return /^https:\/\/[^/]+\.[a-z]{2,}(\/|$)/i.test(u);
}

/** The row's stored decision, validated. Anything malformed reads as "never said". */
export function cleanGbpOptions(raw: unknown): GbpPostOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { button?: unknown; url?: unknown };
  const button = GBP_BUTTONS.includes(o.button as GbpButton) ? (o.button as GbpButton) : null;
  if (!button) return null;
  const url = usableCtaUrl(o.url) ? (o.url as string).trim() : null;
  return { button, url };
}

export interface GbpCtaContext {
  /** The shop's booking page, when the tenant has a slug. */
  bookingUrl: string | null;
  /** The shop's website, when it gave one. */
  website: string | null;
}

/** The link the button would use if the writer types nothing. */
export function defaultGbpUrl(button: GbpButton, ctx: GbpCtaContext): string | null {
  if (button === 'book') return usableCtaUrl(ctx.bookingUrl) ? ctx.bookingUrl : null;
  if (button === 'learn') {
    if (usableCtaUrl(ctx.website)) return ctx.website;
    return usableCtaUrl(ctx.bookingUrl) ? ctx.bookingUrl : null;
  }
  return null;
}

export type GbpCta =
  | { actionType: 'BOOK' | 'LEARN_MORE'; url: string }
  | { actionType: 'CALL' };

/**
 * What goes to Google. Null means "no button", which is always a legal post.
 *
 * Absent options (a row written before the button existed) resolve to the
 * default — a Book button on the shop's own page — so old scheduled posts
 * keep the button they always had.
 */
export function resolveGbpCta(opts: GbpPostOptions | null, ctx: GbpCtaContext): GbpCta | null {
  const button = opts?.button ?? DEFAULT_GBP_BUTTON;
  if (button === 'none') return null;
  if (button === 'call') return { actionType: 'CALL' };
  const url = (opts?.url && usableCtaUrl(opts.url) ? opts.url : null) ?? defaultGbpUrl(button, ctx);
  if (!url) return null;
  return { actionType: button === 'book' ? 'BOOK' : 'LEARN_MORE', url };
}

/**
 * Why the button as chosen cannot be sent — for the composer, at write time.
 *
 * Null when it is fine. The scheduler never sees this: by the time a post is
 * due, resolveGbpCta has already quietly dropped a button it cannot honour,
 * and a post without a button beats a post that never went out.
 */
export function gbpCtaProblem(opts: GbpPostOptions | null, ctx: GbpCtaContext): { vi: string; en: string } | null {
  const button = opts?.button ?? DEFAULT_GBP_BUTTON;
  if (button === 'none' || button === 'call') return null;
  if (opts?.url && !usableCtaUrl(opts.url)) {
    return {
      vi: 'Link cho nút chưa đúng — phải bắt đầu bằng https:// và không có khoảng trắng.',
      en: 'The button link is not valid — it must start with https:// and contain no spaces.',
    };
  }
  if (resolveGbpCta(opts, ctx)) return null;
  return button === 'book'
    ? {
      vi: 'Nút Đặt lịch cần một link, mà tiệm chưa có trang đặt lịch. Dán link vào ô bên dưới, hoặc đổi nút sang Gọi ngay.',
      en: 'The Book button needs a link and this shop has no booking page yet. Paste a link below, or switch the button to Call now.',
    }
    : {
      vi: 'Nút Tìm hiểu thêm cần một link — tiệm chưa có website. Dán link vào ô bên dưới, hoặc đổi nút.',
      en: 'The Learn more button needs a link and this shop has no website on file. Paste a link below, or choose another button.',
    };
}
