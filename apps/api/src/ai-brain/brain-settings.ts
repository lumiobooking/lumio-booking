/**
 * THE SALON'S AI BRAIN — one setting per salon that every assistant reads.
 *
 * The hotline, Messenger, Instagram, Zalo and the website chat used to keep
 * their own copies of the same ideas: a greeting here, an "extra note"
 * there, the FAQ facts on the Messenger connection (so a hotline-only salon
 * had no facts at all). The owner typed a rule into one and forgot the
 * other, and the two assistants disagreed. This is the one place.
 *
 * Stored as the `ai_brain` setting of the tenant. A salon that never saved
 * one is read through `brainFromLegacy`, which assembles the old fields so
 * nothing changes for it until the owner saves the new screen once.
 *
 * Pure: no database, no clock (tested in brain-settings.spec.ts).
 */

export type Lang = 'en' | 'vi' | 'es' | 'zh' | 'ko' | 'fr' | 'ja';
export const LANGS: Lang[] = ['en', 'vi', 'es', 'zh', 'ko', 'fr', 'ja'];
export const LANG_NAME: Record<Lang, { en: string; native: string }> = {
  en: { en: 'English', native: 'English' },
  vi: { en: 'Vietnamese', native: 'Tiếng Việt' },
  es: { en: 'Spanish', native: 'Español' },
  zh: { en: 'Chinese', native: '中文' },
  ko: { en: 'Korean', native: '한국어' },
  fr: { en: 'French', native: 'Français' },
  ja: { en: 'Japanese', native: '日本語' },
};
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (LANGS as string[]).includes(x);

export type Tone = 'warm' | 'professional' | 'brief';
export type VoiceOpening = 'auto' | 'menu' | 'single';
export type WhenFull = 'offer-nearest' | 'say-full' | 'waitlist';

/** One thing the AI should know. `from` / `until` (YYYY-MM-DD, salon days) limit a seasonal fact — a holiday hour, an opening offer — and it drops out of every assistant on its own after `until`. */
export interface BrainFact { label: string; value: string; on: boolean; from?: string; until?: string }

export interface AiBrain {
  persona: { agentName: string; tone: Tone; intro: string; greeting: string; signoff: string };
  languages: { primary: Lang; allowed: Lang[]; voiceOpening: VoiceOpening };
  knowledge: { facts: BrainFact[]; rules: string };
  booking: {
    canBook: boolean; allowGroup: boolean; maxParty: number; canReschedule: boolean; canCancel: boolean;
    askExtras: boolean; whenFull: WhenFull;
  };
  handoff: {
    transferNumber: string; silenceRetries: number; staffQuietMins: number;
    notifyOwnerPush: boolean; notifyDeskPush: boolean; notifyOwnerSms: boolean;
  };
  channels: {
    voice: { greeting: string; extra: string };
    /** `greeting` mirrors the Messenger connection's greeting (what the Page shows); `yieldMins` its graceMins. */
    chat: { greeting: string; extra: string; sendPhotos: boolean; nudgeHours: number; yieldMins: number };
  };
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const AI_BRAIN_KEY = 'ai_brain';

export function defaultBrain(market?: string | null): AiBrain {
  const vn = String(market ?? '').toUpperCase() === 'VN';
  return {
    persona: { agentName: '', tone: 'warm', intro: '', greeting: '', signoff: '' },
    languages: { primary: vn ? 'vi' : 'en', allowed: ['en', 'vi'], voiceOpening: 'auto' },
    knowledge: { facts: [], rules: '' },
    booking: { canBook: true, allowGroup: true, maxParty: 6, canReschedule: true, canCancel: false, askExtras: true, whenFull: 'offer-nearest' },
    handoff: { transferNumber: '', silenceRetries: 3, staffQuietMins: 15, notifyOwnerPush: true, notifyDeskPush: true, notifyOwnerSms: false },
    channels: { voice: { greeting: '', extra: '' }, chat: { greeting: '', extra: '', sendPhotos: true, nudgeHours: 2, yieldMins: 5 } },
    version: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : d);

export function cleanFacts(raw: unknown): BrainFact[] {
  if (!Array.isArray(raw)) return [];
  const out: BrainFact[] = [];
  for (const f of raw.slice(0, 80)) {
    const o = obj(f);
    const label = str(o.label, 80);
    const value = str(o.value, 600);
    if (!label && !value) continue;
    const from = day(o.from), until = day(o.until);
    out.push({ label: label || value.slice(0, 40), value, on: bool(o.on, true), ...(from ? { from } : {}), ...(until ? { until } : {}) });
  }
  return out;
}

/** Stored or sent settings made safe on top of `base`; unknown keys dropped, numbers clamped. */
export function sanitizeBrain(raw: unknown, base: AiBrain): AiBrain {
  const r = obj(raw);
  const p = obj(r.persona), l = obj(r.languages), k = obj(r.knowledge), b = obj(r.booking), h = obj(r.handoff);
  const ch = obj(r.channels), cv = obj(ch.voice), cc = obj(ch.chat);
  const primary = isLang(l.primary) ? l.primary : base.languages.primary;
  let allowed = Array.isArray(l.allowed) ? l.allowed.filter(isLang) : base.languages.allowed;
  allowed = [...new Set([primary, ...allowed])];
  return {
    persona: {
      agentName: 'agentName' in p ? str(p.agentName, 40) : base.persona.agentName,
      tone: oneOf(p.tone, ['warm', 'professional', 'brief'] as const, base.persona.tone),
      intro: 'intro' in p ? str(p.intro, 300) : base.persona.intro,
      greeting: 'greeting' in p ? str(p.greeting, 300) : base.persona.greeting,
      signoff: 'signoff' in p ? str(p.signoff, 200) : base.persona.signoff,
    },
    languages: { primary, allowed, voiceOpening: oneOf(l.voiceOpening, ['auto', 'menu', 'single'] as const, base.languages.voiceOpening) },
    knowledge: {
      facts: 'facts' in k ? cleanFacts(k.facts) : base.knowledge.facts,
      rules: 'rules' in k ? str(k.rules, 4000) : base.knowledge.rules,
    },
    booking: {
      canBook: bool(b.canBook, base.booking.canBook),
      allowGroup: bool(b.allowGroup, base.booking.allowGroup),
      maxParty: int(b.maxParty, base.booking.maxParty, 1, 10),
      canReschedule: bool(b.canReschedule, base.booking.canReschedule),
      canCancel: bool(b.canCancel, base.booking.canCancel),
      askExtras: bool(b.askExtras, base.booking.askExtras),
      whenFull: oneOf(b.whenFull, ['offer-nearest', 'say-full', 'waitlist'] as const, base.booking.whenFull),
    },
    handoff: {
      transferNumber: 'transferNumber' in h ? str(h.transferNumber, 40).replace(/[^\d+\s().-]/g, '') : base.handoff.transferNumber,
      silenceRetries: int(h.silenceRetries, base.handoff.silenceRetries, 1, 5),
      staffQuietMins: int(h.staffQuietMins, base.handoff.staffQuietMins, 1, 720),
      notifyOwnerPush: bool(h.notifyOwnerPush, base.handoff.notifyOwnerPush),
      notifyDeskPush: bool(h.notifyDeskPush, base.handoff.notifyDeskPush),
      notifyOwnerSms: bool(h.notifyOwnerSms, base.handoff.notifyOwnerSms),
    },
    channels: {
      voice: { greeting: 'greeting' in cv ? str(cv.greeting, 300) : base.channels.voice.greeting, extra: 'extra' in cv ? str(cv.extra, 1500) : base.channels.voice.extra },
      chat: {
        greeting: 'greeting' in cc ? str(cc.greeting, 300) : base.channels.chat.greeting,
        extra: 'extra' in cc ? str(cc.extra, 1500) : base.channels.chat.extra,
        sendPhotos: bool(cc.sendPhotos, base.channels.chat.sendPhotos),
        nudgeHours: int(cc.nudgeHours, base.channels.chat.nudgeHours, 0, 72),
        yieldMins: int(cc.yieldMins, base.channels.chat.yieldMins, 0, 60),
      },
    },
    version: base.version,
    updatedAt: base.updatedAt,
    updatedBy: base.updatedBy,
  };
}

/** What the old screens held, as one brain — read until the owner saves the new screen once. */
export interface LegacySources {
  market?: string | null;
  messenger?: { greeting?: string | null; closing?: string | null; agentName?: string | null; bizIntro?: string | null; aiInstruction?: string | null; botFacts?: unknown } | null;
  voice?: { greeting?: string | null; language?: string | null; aiInstruction?: string | null; transferNumber?: string | null } | null;
  aiNotes?: string | null;
}

export function brainFromLegacy(src: LegacySources): AiBrain {
  const d = defaultBrain(src.market);
  const m = src.messenger ?? {};
  const v = src.voice ?? {};
  const vl = String(v.language ?? '');
  const primary: Lang = /^vi/i.test(vl) ? 'vi' : d.languages.primary;
  const bilingual = /bi|both|vi.*en|en.*vi/i.test(vl) || vl.includes(',');
  return sanitizeBrain({
    persona: { agentName: m.agentName ?? '', intro: m.bizIntro ?? '', greeting: m.greeting ?? '', signoff: m.closing ?? '' },
    languages: { primary, allowed: ['en', 'vi'], voiceOpening: bilingual ? 'menu' : vl && !bilingual ? 'auto' : 'auto' },
    knowledge: { facts: m.botFacts, rules: String(src.aiNotes ?? '').trim() },
    handoff: { transferNumber: v.transferNumber ?? '' },
    channels: { voice: { greeting: v.greeting ?? '', extra: v.aiInstruction ?? '' }, chat: { extra: m.aiInstruction ?? '' } },
  }, d);
}

// ---------------------------------------------------------------- prompt blocks

export interface PromptCtx {
  channel: 'voice' | 'chat';
  salonName: string;
  venueNoun: string;
  lang: Lang;
  /** The salon's today (YYYY-MM-DD): facts dated outside it are left out. Omitted = every fact. */
  today?: string;
}

/** Is this fact in force on `today`? (No dates = always.) */
export function factInForce(f: BrainFact, today?: string): boolean {
  if (!today) return true;
  if (f.from && today < f.from) return false;
  if (f.until && today > f.until) return false;
  return true;
}

/** The lines of the prompt that come from the brain — the same text for every channel. */
export function brainPromptBlocks(brain: AiBrain, ctx: PromptCtx): {
  persona: string; facts: string; rules: string; booking: string; handoffNote: string; language: string;
} {
  const name = brain.persona.agentName.trim();
  const toneLine = brain.persona.tone === 'professional'
    ? 'Tone: courteous and professional, no slang, no emoji.'
    : brain.persona.tone === 'brief'
      ? 'Tone: brief and to the point — the shortest helpful reply, one question at a time.'
      : 'Tone: warm and friendly, like a receptionist who likes her regulars.';
  const persona = [
    name ? `Your name is ${name}; introduce yourself as ${name} once when the conversation starts, never as an "assistant" or "bot".` : '',
    brain.persona.intro ? `About the ${ctx.venueNoun}, in the owner's words: ${brain.persona.intro}` : '',
    toneLine,
    brain.persona.signoff ? `When the conversation wraps up, close in the spirit of: "${brain.persona.signoff}" (say it in the customer's language).` : '',
  ].filter(Boolean).join('\n');

  const facts = brain.knowledge.facts.filter((f) => f.on && f.value.trim() && factInForce(f, ctx.today)).map((f) => `- ${f.label.trim()}: ${f.value.trim()}`).join('\n');
  const extra = ctx.channel === 'voice' ? brain.channels.voice.extra : brain.channels.chat.extra;
  const rules = [brain.knowledge.rules.trim(), extra.trim()].filter(Boolean).join('\n');

  const b = brain.booking;
  const booking = [
    b.canBook ? '' : `The ${ctx.venueNoun} does NOT take bookings through you: answer questions, then say a staff member will call to book, and call request_callback with what they want.`,
    b.canBook && !b.allowGroup ? 'You book ONE person per conversation. For a group, take the details and call request_callback — the desk books groups.' : '',
    b.canBook && b.allowGroup ? `Groups of up to ${b.maxParty} people may be booked here. For more than ${b.maxParty}, take the day, time and head count and call request_callback — the desk arranges large parties.` : '',
    !b.canReschedule ? 'You may NOT move an existing appointment: offer to have the desk call back and call request_callback.' : '',
    !b.canCancel ? 'You may NOT cancel an appointment: say the desk will confirm the cancellation and call request_callback with the appointment details.' : '',
    b.whenFull === 'say-full' ? 'When the asked time is taken, say so and let the customer name another — do not list alternatives unless asked.'
      : b.whenFull === 'waitlist' ? 'When the asked time is taken, offer the nearest open times AND offer to put them on the waiting list for the time they wanted (call request_callback with "waitlist" and the details).'
        : 'When the asked time is taken, offer the 2–3 nearest open times.',
    !b.askExtras ? 'Do not ask about optional add-ons unless the customer brings them up.' : '',
  ].filter(Boolean).join('\n');

  const handoffNote = ctx.channel === 'voice'
    ? (brain.handoff.transferNumber ? 'A real person can be reached by transfer.' : 'Nobody can be transferred to right now: when you cannot help, call request_callback and promise a call back.')
    : 'When you cannot answer from what you were given, say the team will get back to them and call request_callback with the question.';

  return { persona, facts, rules, booking, handoffNote, language: languageRule(ctx.lang, brain.languages.allowed) };
}

/** The language rule for one reply: this customer's language, named plainly, both directions. */
export function languageRule(lang: Lang, allowed: Lang[]): string {
  const name = LANG_NAME[lang]?.en ?? 'English';
  const others = allowed.filter((l) => l !== lang).map((l) => LANG_NAME[l].en);
  const vi = lang === 'vi' ? ' Be politely warm: use "dạ" and "ạ", address the customer as "anh/chị".' : '';
  return `LANGUAGE — NOT NEGOTIABLE: this customer is using ${name.toUpperCase()}, so every word you send is in ${name}.${vi} The ${others.length ? `${others.join(', ')} ` : ''}notes, menu lines, tool results, system messages, or earlier messages the salon sent in this chat (an ad greeting, a staff line) may be in another language — never copy their language — translate what you need and answer only in ${name}. Never mix two languages in one reply. One borrowed word ("ok", "thank you") never switches the language; switch only when the customer writes a whole sentence in another language${others.length ? ` (${others.join(', ')})` : ''}.`;
}

// ---------------------------------------------------------------- old notes → the brain, once

/** One old note that the brain does not hold yet, and where it would go. */
export interface LegacyNote {
  source: 'ai_notes' | 'messenger_note' | 'messenger_intro' | 'messenger_facts' | 'voice_note' | 'messenger_name' | 'messenger_closing';
  /** Where it was typed, as the owner saw it. */
  where: { vi: string; en: string };
  /** Where it lands in the brain. */
  into: { vi: string; en: string };
  text: string;
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
const holds = (haystack: string, needle: string) => !needle.trim() || norm(haystack).includes(norm(needle));

/**
 * Every note typed on the old screens (Messenger "Cách trả lời", "Thông tin
 * doanh nghiệp", the shared "Ghi chú chung cho AI" box, the Hotline note)
 * that the saved brain does not already contain. Once the brain has been
 * saved, the assistants read only the brain — these notes stopped reaching
 * them, which is why "I told the AI and it did not listen". Pure.
 */
export function legacyNotes(brain: AiBrain, src: LegacySources): LegacyNote[] {
  const m = src.messenger ?? {};
  const v = src.voice ?? {};
  const out: LegacyNote[] = [];
  const allText = [brain.knowledge.rules, brain.channels.chat.extra, brain.channels.voice.extra, brain.persona.intro, ...brain.knowledge.facts.map((f) => `${f.label}: ${f.value}`)].join('\n');
  const add = (source: LegacyNote['source'], where: LegacyNote['where'], into: LegacyNote['into'], text: string | null | undefined, inside: string) => {
    const t = String(text ?? '').trim();
    if (t && !holds(inside, t)) out.push({ source, where, into, text: t });
  };
  add('ai_notes', { vi: 'Hộp "Ghi chú chung cho AI" (Messenger, Hotline)', en: '"Shared notes for the AI" box (Messenger, Hotline)' }, { vi: 'Kiến thức › Cách tiệm vận hành', en: 'Knowledge › How the salon runs' }, src.aiNotes, allText);
  add('messenger_note', { vi: 'Messenger › Ghi chú thêm cho bot', en: 'Messenger › Extra notes for the bot' }, { vi: 'Tin nhắn › Dặn thêm chỉ khi nhắn tin', en: 'Messages › Extra for chat' }, m.aiInstruction, allText);
  add('voice_note', { vi: 'Hotline › Ghi chú thêm cho trợ lý', en: 'Hotline › Extra notes for the assistant' }, { vi: 'Điện thoại › Dặn thêm chỉ khi nói điện thoại', en: 'Phone › Extra for the phone' }, v.aiInstruction, allText);
  add('messenger_intro', { vi: 'Messenger › Giới thiệu doanh nghiệp', en: 'Messenger › Business intro' }, { vi: 'Nhân cách › Giới thiệu tiệm', en: 'Persona › The salon in one sentence' }, m.bizIntro, allText);
  if (!brain.persona.agentName && String(m.agentName ?? '').trim()) out.push({ source: 'messenger_name', where: { vi: 'Messenger › Tên nhân viên', en: 'Messenger › Staff name' }, into: { vi: 'Nhân cách › Tên trợ lý', en: 'Persona › Assistant name' }, text: String(m.agentName).trim() });
  if (!brain.persona.signoff && String(m.closing ?? '').trim()) out.push({ source: 'messenger_closing', where: { vi: 'Messenger › Câu kết thúc', en: 'Messenger › Goodbye line' }, into: { vi: 'Nhân cách › Câu kết thúc', en: 'Persona › Sign-off' }, text: String(m.closing).trim() });
  for (const f of cleanFacts(m.botFacts)) {
    if (!f.value.trim()) continue;
    const known = brain.knowledge.facts.some((x) => norm(x.label) === norm(f.label) && norm(x.value) === norm(f.value));
    if (!known) out.push({ source: 'messenger_facts', where: { vi: 'Messenger › Thông tin doanh nghiệp', en: 'Messenger › Business info' }, into: { vi: 'Kiến thức tiệm', en: 'Knowledge' }, text: `${f.label}: ${f.value}${f.from || f.until ? ` (${f.from ?? '…'} → ${f.until ?? '…'})` : ''}` });
  }
  return out;
}

/** The brain with every old note from `legacyNotes` moved in (appended, never overwriting). Pure. */
export function mergeLegacy(brain: AiBrain, src: LegacySources): AiBrain {
  const notes = legacyNotes(brain, src);
  if (!notes.length) return brain;
  const m = src.messenger ?? {};
  const v = src.voice ?? {};
  const join = (a: string, b: string | null | undefined) => [a.trim(), String(b ?? '').trim()].filter(Boolean).join('\n');
  const has = (s: LegacyNote['source']) => notes.some((n) => n.source === s);
  const next: AiBrain = JSON.parse(JSON.stringify(brain));
  if (has('ai_notes')) next.knowledge.rules = join(next.knowledge.rules, src.aiNotes).slice(0, 4000);
  if (has('messenger_note')) next.channels.chat.extra = join(next.channels.chat.extra, m.aiInstruction).slice(0, 1500);
  if (has('voice_note')) next.channels.voice.extra = join(next.channels.voice.extra, v.aiInstruction).slice(0, 1500);
  if (has('messenger_intro')) {
    if (!next.persona.intro.trim()) next.persona.intro = String(m.bizIntro ?? '').trim().slice(0, 300);
    else next.knowledge.rules = join(next.knowledge.rules, String(m.bizIntro ?? '')).slice(0, 4000);
  }
  if (has('messenger_name')) next.persona.agentName = String(m.agentName ?? '').trim().slice(0, 40);
  if (has('messenger_closing')) next.persona.signoff = String(m.closing ?? '').trim().slice(0, 200);
  if (has('messenger_facts')) {
    for (const f of cleanFacts(m.botFacts)) {
      if (!f.value.trim()) continue;
      const i = next.knowledge.facts.findIndex((x) => norm(x.label) === norm(f.label));
      if (i >= 0 && norm(next.knowledge.facts[i].value) === norm(f.value)) continue;
      if (i >= 0) next.knowledge.facts.push({ ...f, label: `${f.label} (2)`.slice(0, 80) });
      else next.knowledge.facts.push(f);
    }
    next.knowledge.facts = next.knowledge.facts.slice(0, 80);
  }
  return next;
}
