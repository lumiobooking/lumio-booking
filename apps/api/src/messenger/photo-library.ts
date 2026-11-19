/**
 * Thư viện ảnh gửi khách (19/11/2026) — which picture answers which question.
 *
 * WHY THIS EXISTS
 *
 * The AI used to pick "samples" by searching the salon's posted posts for a
 * word in the CAPTION. A post that said "French hoặc đỏ cherry đều xinh" was a
 * French sample as far as that search knew, so a customer who asked for French
 * got a red set. Pictures are now chosen from a library the salon owns, by
 * the labels on each picture (kind, service, style words), never by prose
 * that happens to sit near them.
 *
 * Everything here is pure: the service loads ONE salon's rows (tenant_id from
 * the signed-in user or the connected Page) and hands them in.
 */

export const PHOTO_KINDS = ['sample', 'price_list', 'storefront', 'guide', 'promo', 'result'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_FLAGS = ['face', 'phone', 'other_shop'] as const;
export type PhotoFlag = (typeof PHOTO_FLAGS)[number];
export type PhotoMode = 'auto' | 'approve' | 'off';
export type PhotoStatus = 'ready' | 'pending';
export type PhotoSource = 'upload' | 'service' | 'branding' | 'post' | 'chat';

export const RULES_KEY = 'messenger.photo_rules';
export const PENDING_KEY = 'messenger.photo_pending';
export const IMPORTED_KEY = 'messenger.photo_library_imported';

export type PhotoRules = {
  modes: Record<PhotoKind, PhotoMode>;
  /** A picture scoring at least this is sent outright; between 0.5 and this: one picture and a question. */
  minScore: 0.7 | 0.8 | 0.9;
  max: 1 | 2 | 3;
  /** No matching picture: tell the team (a waiting suggestion in the Inbox) or say nothing. */
  whenNone: 'notify' | 'quiet';
};

export const DEFAULT_RULES: PhotoRules = {
  modes: { sample: 'auto', price_list: 'auto', storefront: 'auto', guide: 'auto', promo: 'approve', result: 'off' },
  minScore: 0.8,
  max: 3,
  whenNone: 'notify',
};

/** Never stored by a browser as-is: every field is read back into a known value. */
export function cleanRules(raw: unknown): PhotoRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PhotoRules> & { modes?: Record<string, unknown> };
  const modes = { ...DEFAULT_RULES.modes };
  for (const k of PHOTO_KINDS) {
    const v = r.modes?.[k];
    if (v === 'auto' || v === 'approve' || v === 'off') modes[k] = v;
  }
  // A customer's own result photo never goes out without a person looking at it.
  if (modes.result === 'auto') modes.result = 'approve';
  const minScore = r.minScore === 0.7 || r.minScore === 0.9 ? r.minScore : 0.8;
  const max = r.max === 1 || r.max === 2 ? r.max : 3;
  const whenNone = r.whenNone === 'quiet' ? 'quiet' : 'notify';
  return { modes, minScore, max, whenNone };
}

export type LibItem = {
  id: string;
  url: string;
  kind: PhotoKind;
  title: string;
  serviceId: string | null;
  serviceName?: string | null;
  tags: string[];
  aiAllowed: boolean;
  expiresAt: Date | null;
  flags: string[];
  consent: boolean;
  status: PhotoStatus;
  /** For a price list: the menu prices it was checked against (see priceSignature). */
  priceSig?: string | null;
  /** 'chat' = a picture a customer sent: never used without their consent. */
  source?: string | null;
};

export function isKind(v: unknown): v is PhotoKind {
  return typeof v === 'string' && (PHOTO_KINDS as readonly string[]).includes(v);
}

/** Lower case, no Vietnamese marks, đ → d, one space between words. */
export function fold(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Words that carry no picture: greetings, pronouns, "do you have", "show me". */
const STOP = new Set([
  'co', 'mau', 'mau', 'nao', 'khong', 'ko', 'k', 'cho', 'xem', 'em', 'chi', 'anh', 'oi', 'a', 'nha', 'nhe', 'voi', 'la', 'thi',
  'cua', 'tiem', 'ben', 'shop', 'lam', 'duoc', 'hinh', 'anh', 'gui', 'minh', 'toi', 'ban', 'ha', 'ah', 'vay', 'the', 'nay', 'kia',
  'nail', 'nails', 'design', 'designs', 'show', 'me', 'some', 'any', 'do', 'you', 'have', 'can', 'i', 'see', 'a', 'an', 'of',
  'photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'please', 'pls', 'and', 'or', 'with', 'for', 'to', 'in', 'on', 'is',
  'kieu', 'loai', 'cai', 'mot', 'vai', 'it', 'nhieu', 'dep', 'xinh', 'hot', 'moi', 'nhat',
]);

export function wordsOf(s: unknown): string[] {
  return Array.from(new Set(fold(s).split(' ').filter((w) => w.length >= 2 && !STOP.has(w))));
}

/** The words a picture answers to: its labels, its title and its service. */
export function itemWords(item: Pick<LibItem, 'tags' | 'title' | 'serviceName'>): Set<string> {
  const out = new Set<string>();
  for (const src of [...(item.tags ?? []), item.title, item.serviceName ?? '']) for (const w of fold(src).split(' ')) if (w.length >= 2) out.add(w);
  return out;
}

/**
 * Whether the menu changed since this price-list picture was put up. The
 * signature is every active service's id and price, sorted — a renamed
 * description does not change it, a changed price does.
 */
export function priceSignature(services: { id: string; priceCents: number | null | undefined }[]): string {
  const rows = services.map((s) => `${s.id}:${Number(s.priceCents ?? 0)}`).sort();
  let h = 2166136261;
  for (const ch of rows.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export type BlockReason = 'pending' | 'ai_off' | 'expired' | 'flagged' | 'price_stale' | 'no_consent';

/** Why the AI may NOT send this picture on its own (null = it may). A person in the Inbox is asked only about flags. */
export function blockedReason(item: LibItem, now: Date, priceSig?: string | null): BlockReason | null {
  if (item.status !== 'ready') return 'pending';
  if (!item.aiAllowed) return 'ai_off';
  if (item.expiresAt && item.expiresAt.getTime() < now.getTime()) return 'expired';
  if (item.flags?.length && !item.consent) return 'flagged';
  if ((item.kind === 'result' || item.source === 'chat') && !item.consent) return 'no_consent';
  if (item.kind === 'price_list' && priceSig && item.priceSig && item.priceSig !== priceSig) return 'price_stale';
  return null;
}

/** Which kinds answer a request of this kind: a sample may be a past customer's result the salon has permission to show. */
export function kindsFor(kind: PhotoKind): PhotoKind[] {
  return kind === 'sample' ? ['sample', 'result'] : [kind];
}

export type Want = { kind: PhotoKind; serviceId?: string | null; words: string[] };

/**
 * How well a picture answers the request, 0 – 1.
 *  - price list / storefront: the kind is the whole question.
 *  - guide / promo: the kind, and the service when one was named.
 *  - sample: the service named (half) and the style words (half); with only
 *    one of the two, that one decides; with neither ("có mẫu nào không"),
 *    every sample is a fair 0.6 and the newest go first.
 */
export function scoreItem(item: LibItem, want: Want): number {
  if (!kindsFor(want.kind).includes(item.kind)) return 0;
  if (want.kind === 'price_list' || want.kind === 'storefront') return 1;
  const svc = want.serviceId ? (item.serviceId === want.serviceId ? 1 : 0) : null;
  if (want.kind === 'guide' || want.kind === 'promo') return svc == null ? 1 : svc === 1 || !item.serviceId ? 1 : 0.3;
  const iw = itemWords(item);
  const ws = want.words.filter(Boolean);
  const word = ws.length ? ws.filter((w) => iw.has(w)).length / ws.length : null;
  if (svc == null && word == null) return 0.6;
  if (svc == null) return word as number;
  if (word == null) return svc;
  return 0.5 * svc + 0.5 * word;
}

export type PickDecision = 'send' | 'ask' | 'approve' | 'none' | 'off';
export type Picked = { item: LibItem; score: number };
export type PickResult = {
  decision: PickDecision;
  picked: Picked[];
  /** Pictures of the right kind the AI was not allowed to use, and why (for the reply and the owner). */
  blocked: { id: string; title: string; reason: BlockReason }[];
  /** Every matching picture had already been sent in this conversation. */
  allSent: boolean;
};

/**
 * The whole decision for one request. `sent` is every picture URL already in
 * this conversation, so asking twice brings new pictures, not the same ones.
 */
export function pickPhotos(items: LibItem[], want: Want, opts: { now: Date; sent: Set<string>; priceSig?: string | null; rules: PhotoRules }): PickResult {
  const mode = opts.rules.modes[want.kind];
  const ofKind = items.filter((i) => kindsFor(want.kind).includes(i.kind));
  const blocked: PickResult['blocked'] = [];
  const usable: LibItem[] = [];
  for (const i of ofKind) {
    const why = blockedReason(i, opts.now, opts.priceSig);
    if (why) blocked.push({ id: i.id, title: i.title, reason: why });
    else usable.push(i);
  }
  if (mode === 'off') return { decision: 'off', picked: [], blocked, allSent: false };
  const scored = usable.map((item) => ({ item, score: scoreItem(item, want) })).filter((p) => p.score >= 0.5);
  const fresh = scored.filter((p) => !opts.sent.has(p.item.url));
  const allSent = scored.length > 0 && fresh.length === 0;
  fresh.sort((a, b) => b.score - a.score);
  if (!fresh.length) return { decision: 'none', picked: [], blocked, allSent };
  const strong = fresh.filter((p) => p.score >= opts.rules.minScore).slice(0, opts.rules.max);
  const picked = strong.length ? strong : fresh.slice(0, 1);
  const decision: PickDecision = mode === 'approve' ? 'approve' : strong.length ? 'send' : 'ask';
  return { decision, picked, blocked, allSent };
}

/**
 * Pictures to offer a PERSON in the Inbox for what the customer just wrote:
 * every kind, best first, with the reason a picture should not go (already
 * sent, flagged) shown rather than hidden — the person decides.
 */
export function suggestFor(items: LibItem[], text: string, opts: { now: Date; sent: Set<string>; priceSig?: string | null }): { item: LibItem; score: number; sent: boolean; blocked: BlockReason | null }[] {
  const t = fold(text);
  const words = wordsOf(text);
  const wantKind: PhotoKind | null = /\b(gia|bang gia|price|prices|menu|bao nhieu|how much)\b/.test(t) ? 'price_list'
    : /\b(dia chi|o dau|duong|map|address|where|cho nao)\b/.test(t) ? 'storefront'
      : /\b(khuyen mai|giam|uu dai|promo|discount|sale)\b/.test(t) ? 'promo'
        : null;
  const scored = items.filter((i) => i.status === 'ready').map((item) => {
    let score: number;
    if (wantKind && kindsFor(wantKind).includes(item.kind)) score = 1;
    else if (item.kind === 'sample' || item.kind === 'result') {
      const iw = itemWords(item);
      score = words.length ? words.filter((w) => iw.has(w)).length / words.length : 0.3;
    } else score = 0.1;
    const why = blockedReason(item, opts.now, opts.priceSig);
    // A person may send what the AI may not (switched off for the AI, pending) — except a flagged picture without consent.
    const blockedForPerson = why === 'flagged' || why === 'no_consent' || why === 'expired' || why === 'price_stale' ? why : null;
    return { item, score, sent: opts.sent.has(item.url), blocked: blockedForPerson };
  });
  return scored.sort((a, b) => Number(a.sent) - Number(b.sent) || b.score - a.score).slice(0, 12);
}

/** What the AI is told, so it says something true about the pictures. */
export function toolAnswer(r: PickResult, sentCount: number, label: string): string {
  if (r.decision === 'off') return 'NONE — this salon does not let the AI send this kind of picture. Answer in words; if they want pictures, say a staff member will send some.';
  if (r.decision === 'approve') return 'WAITING — the salon checks these pictures before they go out; a staff member has been asked to send them. Tell the customer the salon will send the pictures in a moment, then continue. Do not describe them.';
  if (r.decision === 'none') {
    if (r.allSent) return `NONE NEW — every picture of "${label}" the salon has is already in this chat. Say those are the ones the salon has, and offer to book or ask what they like.`;
    if (r.blocked.some((b) => b.reason === 'price_stale')) return 'NONE — the price-list picture is older than the current prices. Give the prices in words from get_services instead; never mention an old picture.';
    if (r.blocked.some((b) => b.reason === 'expired')) return 'NONE — that promotion has ended. Do not offer it; answer from the current facts.';
    return `NONE — no picture of "${label}" on file. Say the salon will send some shortly, and continue.`;
  }
  if (!sentCount) return 'ERROR — the pictures could not be delivered on this channel. Answer in words instead; do not mention pictures.';
  if (r.decision === 'ask') return `SUCCESS — 1 picture close to "${label}" is now in the chat (not an exact match). Write ONE short line asking whether this style is what they mean, or what they would change. Do not say "attached".`;
  return `SUCCESS — ${sentCount} picture(s) of "${label}" are now in the chat, above your reply. Write ONE short line to go with them (e.g. which service they show, or a question about what they like). Do not say "attached" or describe them in detail.`;
}

/** Waiting suggestions per conversation, kept small: the newest 50 threads. */
export type PendingMap = Record<string, { ids: string[]; label: string; at: string }>;
export function cleanPending(raw: unknown): PendingMap {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const rows = Object.entries(o)
    .map(([k, v]) => {
      const x = v as { ids?: unknown; label?: unknown; at?: unknown } | null;
      const ids = Array.isArray(x?.ids) ? x!.ids.filter((i): i is string => typeof i === 'string').slice(0, 3) : [];
      return [k, { ids, label: String(x?.label ?? '').slice(0, 80), at: String(x?.at ?? '') }] as const;
    })
    .filter(([k, v]) => /^[A-Za-z0-9_-]{1,64}$/.test(k) && v.ids.length)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, 50);
  return Object.fromEntries(rows);
}

/** The labels a picture reader may suggest, kept to short words. */
export function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: string[] = [];
  for (const t of list) {
    const s = String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

export function cleanFlags(raw: unknown): PhotoFlag[] {
  const list = Array.isArray(raw) ? raw : [];
  return (PHOTO_FLAGS as readonly string[]).filter((f) => list.includes(f)) as PhotoFlag[];
}

/** Read the picture reader's JSON answer, tolerating prose around it. */
export function parseReading(text: string): { title: string; tags: string[]; flags: PhotoFlag[]; kind: PhotoKind | null } | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { title?: unknown; tags?: unknown; flags?: unknown; kind?: unknown };
    return {
      title: String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      tags: cleanTags(o.tags),
      flags: cleanFlags(o.flags),
      kind: isKind(o.kind) ? o.kind : null,
    };
  } catch {
    return null;
  }
}
