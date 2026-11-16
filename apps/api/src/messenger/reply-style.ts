/**
 * HOW A REPLY LOOKS — the approved Messenger style (2026-11-16, owner's
 * mockup "Hỏi trước, gợi ý 1 gói, minh bạch, mời bước tiếp").
 *
 * Customers read on a phone and skim. A 12-line paragraph listing every
 * package with its features ("Social Care $45/tháng: đăng bài đều trên
 * Facebook, Instagram, TikTok và Shorts, kèm…") reads as a wall and as a
 * sales script. The approved shape:
 *
 *   - at most TWO bubbles a turn, at most four lines each, ONE question,
 *     and the question alone in the last bubble;
 *   - lists as one line per item ("▸ Map Growth — $279/th"), never prose;
 *   - choices as tap buttons (Messenger quick replies) written as the
 *     CUSTOMER's words with no pronoun at all — a customer is never made to
 *     call themselves "em" to the business ("Suy nghĩ thêm", not "Để em suy
 *     nghĩ thêm");
 *   - no markdown: Messenger shows ** and # as literal characters.
 *
 * Pure helpers here; messenger.service wires them in.
 */

/** Messenger's limit on a quick-reply title; longer is cut by Meta mid-word. */
export const CHOICE_MAX = 20;
export const MAX_CHOICES = 5;
/** Messenger shows at most this many characters in one text bubble. */
const BUBBLE_MAX = 1900;

export const REPLY_STYLE_RULE = `HOW YOUR REPLY SOUNDS — like an attentive, gracious person in a service business, never a terse bot:
- Every reply has substance: a warm, specific acknowledgement of what they just said, one helpful sentence (an answer, a fact, a reason), then your question. Never a bare one-liner like "Cảm ơn anh/chị đã chia sẻ ạ." or "Dạ, anh/chị chọn mục tiêu nào ạ?" on its own.
- Write full, natural sentences with soft service words ("Dạ", "ạ", "để em…", "anh/chị yên tâm…"), never clipped fragments.
- Short does not mean curt: two or three sentences that care beat one cold line.

HOW YOUR REPLY LOOKS — the customer reads on a phone and skims. Polite, warm, tidy, professional:
- At most TWO short messages per turn. Separate them with ONE blank line; the LAST message holds your single question. Each message at most 4 lines.
- ONE question per turn. At most one emoji per turn.
- Two or more items (packages, services, times): one line each, starting with "▸ ", name and price first, then the key point in a few words. Never a paragraph that lists items.
- Answer what they asked FIRST (a price, a range, a yes/no), then ask.
- When the customer has a choice to make, call offer_choices with 2–5 short options (max 20 characters each). Options are written as the CUSTOMER's own words and contain NO pronoun at all — never "em", "tôi", "mình", "tui", "I": write "Suy nghĩ thêm", "Nhân viên gọi tư vấn", "Xem tất cả gói". After calling it, do NOT list the options in your text — the buttons appear under your message.
- Vietnamese: always call the customer "anh/chị" (or the pronoun they chose for themselves) and yourself "em"; "Dạ"/"ạ" where natural. Never greet again in the middle of a conversation.
- No markdown at all: no **, no #, no tables, no numbered headings.
- After the customer leaves their contact details, confirm in ONE line what you noted (name · phone · what they want).`;

/** The approved sales flow, for a page that quotes from its own documents. */
export const SALES_FLOW_RULE = `THE APPROVED SALES FLOW (prices come from THE BUSINESS'S OWN DOCUMENTS):
1. Asked about packages or prices in general: greet warmly, give the price range, then ask what the shop wants most, and call offer_choices with GOALS, not package names (e.g. "Có thêm khách mới", "Lên top Google Maps", "Trang mạng đẹp", "Làm website", "Xem tất cả gói"). Example of the tone (adapt, never copy):
   "Dạ em chào anh/chị ạ, em là trợ lý bên [business]. Bên em có các gói marketing từ $X đến $Y/tháng, tuỳ tiệm mình đang cần gì nhất ạ.

   Để em tư vấn đúng gói cho tiệm, anh/chị đang muốn ưu tiên điều gì ạ?"
2. Once you know what they want: recommend ONE package that fits with send_package_card (its exact name, exact price, any one-time fee and the commitment from the documents), then ONE line naming the cheaper and the higher option of that group, then ONE question.
3. "Xem tất cả gói", or they ask to compare: send_package_card with the packages of ONE group (the monthly marketing packages first, unless they named another group), then one warm line and offer_choices to see the other groups (e.g. "Gói Google Maps", "Gói Website", "Nhân viên gọi tư vấn"). Never more than 6 cards at once.
4. Next step, never pushy: offer_choices such as "Nhân viên gọi tư vấn", "Gửi bảng giá đầy đủ", "Suy nghĩ thêm". "Suy nghĩ thêm" is answered warmly with no pressure.
5. A question the documents do not answer: say the team will confirm, and offer to take their name and phone.`;

/**
 * Messenger shows markdown as raw characters. Strip it and normalise list
 * bullets, without touching the words.
 */
export function tidyReply(text: string): string {
  let t = String(text ?? '').replace(/\r\n/g, '\n');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(?=\S)/gm, '▸ ');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * At most two bubbles: everything but the last paragraph, then the last
 * paragraph (where the question sits). Short replies stay one bubble.
 */
export function splitBubbles(text: string): string[] {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2 || t.length < 80) return [t.slice(0, BUBBLE_MAX)];
  const last = paras[paras.length - 1];
  const head = paras.slice(0, -1).join('\n\n');
  return [head.slice(0, BUBBLE_MAX), last.slice(0, BUBBLE_MAX)];
}

/**
 * One tap option, as the customer's own words: no pronoun, no trailing
 * punctuation, within Messenger's 20 characters (cut at a word).
 */
export function cleanChoice(raw: unknown): string {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/[.?!…]+$/u, '');
  // "Để em suy nghĩ thêm" / "Em muốn xem giá" / "Tôi cần tư vấn" → no pronoun.
  s = s.replace(/^(?:để\s+|cho\s+)?(?:em|tôi|mình|tui|tớ|i)\s+(?:muốn\s+|cần\s+|sẽ\s+|xin\s+)?/iu, '');
  s = s.replace(/\s+(?:em|tôi|mình|tui)\s*$/iu, '');
  s = s.trim();
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > CHOICE_MAX) {
    const cut = s.slice(0, CHOICE_MAX);
    const sp = cut.lastIndexOf(' ');
    s = (sp >= 8 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

export function cleanChoices(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const x of list) {
    const c = cleanChoice(x);
    if (c && !out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c);
    if (out.length >= MAX_CHOICES) break;
  }
  return out;
}

/** Messenger quick replies for a list of choices. */
export function quickRepliesFor(choices: string[]): { content_type: 'text'; title: string; payload: string }[] {
  return choices.slice(0, MAX_CHOICES).map((c) => ({ content_type: 'text', title: c, payload: `CHOICE:${c}`.slice(0, 900) }));
}

/** Where buttons do not exist (Zalo, the website chat): the options as one plain line. */
export function choicesAsText(choices: string[]): string {
  return choices.length ? choices.map((c) => `▸ ${c}`).join('   ') : '';
}

// ---------------------------------------------------------------- the package card

export interface PackageCard { name: string; price: string; tag?: string; points?: string[] }

/** Messenger generic-template limits. */
const TITLE_MAX = 80;
const SUBTITLE_MAX = 80;

/** One card element: "Map Growth · $279/tháng", the tag and points in the subtitle. */
export function cardElement(c: PackageCard, buttons: unknown[]): { title: string; subtitle: string; buttons: unknown[] } {
  const title = `${String(c.name ?? '').trim()} · ${String(c.price ?? '').trim()}`.replace(/\s+/g, ' ').slice(0, TITLE_MAX);
  const bits = [c.tag, ...(Array.isArray(c.points) ? c.points : [])].map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let subtitle = '';
  for (const b of bits) {
    const next = subtitle ? `${subtitle} · ${b}` : b;
    if (next.length > SUBTITLE_MAX) break;
    subtitle = next;
  }
  if (!subtitle && bits[0]) subtitle = bits[0].slice(0, SUBTITLE_MAX - 1) + '…';
  return { title, subtitle, buttons };
}

export function cleanCards(raw: unknown): PackageCard[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' && String((x as { name: string }).name).trim() !== '')
    .map((x) => ({
      name: String(x.name).trim().slice(0, 60),
      price: String(x.price ?? '').trim().slice(0, 40),
      tag: x.tag ? String(x.tag).trim().slice(0, 40) : undefined,
      points: Array.isArray(x.points) ? x.points.map((p) => String(p ?? '').trim()).filter(Boolean).slice(0, 4) : [],
    }))
    .slice(0, 10);
}

/** All of a card's words, for the price check. */
export function cardText(cards: PackageCard[]): string {
  return cards.map((c) => [c.name, c.price, c.tag, ...(c.points ?? [])].filter(Boolean).join(' ')).join('\n');
}

export const INFO_PREFIX = 'PKG_INFO:';
export const CMP_PREFIX = 'PKG_CMP:';

/** What a card button tap says, as the customer's line (no pronoun). */
export function cardTapLine(payload: string): string | null {
  const p = String(payload ?? '');
  if (p.startsWith(INFO_PREFIX)) return `Xem đủ quyền lợi gói ${p.slice(INFO_PREFIX.length).trim()}`;
  if (p.startsWith(CMP_PREFIX)) return `So sánh gói ${p.slice(CMP_PREFIX.length).trim()} với các gói khác`;
  return null;
}
