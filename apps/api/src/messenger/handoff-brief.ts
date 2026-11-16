/**
 * TÓM TẮT KHI NHÂN VIÊN TIẾP NHẬN — three lines and a draft, on request.
 *
 * When the AI hands a chat over (or a receptionist opens one the customer is
 * still waiting in), the person had to scroll the whole thread to learn what
 * the customer wants. The customer waits while they read, and is often asked
 * again for things already said. One press in the Inbox now gives:
 *
 *   want    — what the customer is asking for, in one line;
 *   done    — what has already been said / done (so nobody asks twice);
 *   missing — what is still open and needs a person;
 *   reply   — a draft answer in the customer's language, which the person
 *             reads, edits and sends themselves. Nothing is sent by this.
 *
 * The draft may only use what is in the conversation and the salon's saved
 * notes; a fact it does not have is left as "[…]" for the person to fill.
 *
 * On request only (one small model call when somebody asks) — never for every
 * thread. Pure here: the prompt and the parsing (handoff-brief.spec.ts).
 */

export interface BriefTurn { role: 'user' | 'assistant'; content: string; manual?: boolean; nudge?: boolean }
export interface HandoffBrief { want: string; done: string; missing: string; reply: string }

const MAX_TURNS = 24;
const cut = (s: string, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** The end of the thread as the model reads it: who said what, stage directions dropped. */
export function briefTranscript(turns: BriefTurn[]): string {
  const rows = turns
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim() && !t.nudge)
    .slice(-MAX_TURNS);
  return rows.map((t) => `${t.role === 'user' ? 'CUSTOMER' : t.manual ? 'STAFF' : 'AI'}: ${cut(t.content, 600)}`).join('\n');
}

/** Is there anything to brief? A thread the customer never wrote in has nothing to summarise. */
export function canBrief(turns: BriefTurn[]): boolean {
  return turns.some((t) => t?.role === 'user' && typeof t.content === 'string' && t.content.trim().length > 0);
}

export function briefPrompt(o: { business: string; vi: boolean; transcript: string; notes?: string | null; agentName?: string | null }): { system: string; user: string } {
  const lang = o.vi ? 'Vietnamese' : 'English';
  const system = [
    `You brief a receptionist at "${o.business}" who is about to take over a customer chat from the AI assistant.`,
    `Write "want", "done" and "missing" in ${lang}, one short line each (max 140 characters), plain words, no markdown.`,
    '- want: what the customer is asking for right now.',
    '- done: what was already answered, offered or booked — so nobody asks the customer twice. "—" if nothing.',
    '- missing: what is still open and needs a person. "—" if nothing.',
    'Write "reply" as the message the receptionist could send next, in the language the CUSTOMER writes in (judge by the customer lines as a whole), 1-3 short sentences, warm and polite, one question at most.',
    o.vi ? 'In a Vietnamese reply the business speaks as "em" and addresses the customer as "anh/chị", with "dạ/ạ". Never put words in the customer\'s mouth.' : '',
    'Use ONLY what is in the conversation and the SAVED NOTES. Never invent a price, a time, a policy or a promise. Where a fact is needed and you do not have it, write "[…]" in its place for the receptionist to fill in.',
    o.agentName ? `The receptionist signs as ${o.agentName} only if the conversation already uses that name.` : '',
    'Return JSON only: {"want":"…","done":"…","missing":"…","reply":"…"}',
  ].filter(Boolean).join('\n');
  const user = [
    o.notes?.trim() ? `SAVED NOTES OF THE BUSINESS:\n${cut(o.notes, 3000)}` : '',
    `CONVERSATION (most recent last):\n${o.transcript}`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/** The model's JSON, read defensively: fenced, with a preamble, or missing a field. Null = unusable. */
export function parseBrief(raw: string): HandoffBrief | null {
  const text = String(raw ?? '');
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>; } catch { return null; }
  const s = (k: string, n: number) => (typeof j[k] === 'string' ? cut(String(j[k]).replace(/\*\*/g, ''), n) : '');
  const want = s('want', 200);
  const reply = typeof j.reply === 'string' ? String(j.reply).replace(/\*\*/g, '').trim().slice(0, 700) : '';
  if (!want && !reply) return null;
  return { want: want || '—', done: s('done', 200) || '—', missing: s('missing', 200) || '—', reply };
}
