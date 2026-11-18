/**
 * WHERE THIS CONVERSATION STANDS (Đợt 2, 18/11/2026).
 *
 * The assistant is handed up to twenty turns of transcript and left to work
 * out, every time, what it has already asked, what it was told and what it
 * has already sent. It mostly does — and when it does not, the customer is
 * greeted a second time, asked for the shop's name they gave four messages
 * ago, or shown the price cards again. Owners call that "the AI forgets".
 *
 * None of those facts needs a model: they are in the transcript. So they are
 * read out of it by code, once per turn, and put in front of the model as a
 * short ledger — a few lines, the closest thing to the customer's message.
 * It only ever describes THIS thread's own turns.
 */

export interface StateTurn { role: 'user' | 'assistant' | string; content?: unknown; manual?: boolean; nudge?: boolean }

const text = (t: StateTurn) => (typeof t.content === 'string' ? t.content : '').replace(/\s+/g, ' ').trim();
/** Our own stage directions ("[Đã gửi 3 ảnh: …]", "[Khách gửi 1 ảnh]") are not things anybody said. */
const isStage = (s: string) => /^\[[^\]]{0,200}\]$/.test(s);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The questions in one message, shortest useful form. */
export function questionsIn(message: string): string[] {
  return String(message ?? '').split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => /[?？]\s*$/.test(s) && s.length >= 6).map((s) => cut(s, 140));
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface ChatState {
  /** Replies already sent by the assistant or the staff. */
  replies: number;
  /** The question the last reply ended on, when the customer has just answered it. */
  openQuestion: string | null;
  /** Earlier questions of ours, oldest first, without the open one. */
  asked: string[];
  /** A question asked two or more times already. */
  askedTwice: string[];
  /** What already went out in this chat. */
  sent: ('photos' | 'link')[];
  /** Phone numbers and e-mail addresses the customer typed. */
  gave: string[];
}

/** Read the ledger out of the turns BEFORE the customer's newest message. */
export function chatState(history: StateTurn[] | null | undefined): ChatState {
  const turns = (history ?? []).filter((t) => t && (t.role === 'user' || t.role === 'assistant'));
  const ours = turns.filter((t) => t.role === 'assistant' && !t.nudge);
  const said = ours.map(text).filter((s) => s && !isStage(s));
  const allQs = said.flatMap(questionsIn);
  const last = [...turns].reverse().find((t) => t.role === 'assistant' && !isStage(text(t)));
  const lastQs = last ? questionsIn(text(last)) : [];
  const openQuestion = lastQs.length ? lastQs[lastQs.length - 1] : null;
  const seen = new Map<string, { q: string; n: number }>();
  for (const q of allQs) { const k = norm(q); if (!k) continue; const x = seen.get(k) ?? { q, n: 0 }; x.n += 1; seen.set(k, x); }
  const openKey = openQuestion ? norm(openQuestion) : '';
  const asked = [...seen.entries()].filter(([k]) => k !== openKey).map(([, v]) => v.q).slice(-4);
  const askedTwice = [...seen.values()].filter((v) => v.n >= 2).map((v) => v.q).slice(-3);
  const oursRaw = turns.filter((t) => t.role === 'assistant').map((t) => (typeof t.content === 'string' ? t.content : '')).join('\n');
  const sent: ChatState['sent'] = [];
  if (/\[(Đã gửi \d+ ảnh|Sent \d+ photos?)/i.test(oursRaw)) sent.push('photos');
  if (/https?:\/\/\S+/i.test(oursRaw)) sent.push('link');
  const theirs = turns.filter((t) => t.role === 'user').map(text).join('\n');
  const gave = [...new Set([
    ...(theirs.match(/(?:[+(]?\d[\d\s().-]{7,16}\d)/g) ?? []).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.replace(/\D/g, '').length >= 9 && p.replace(/\D/g, '').length <= 13),
    ...(theirs.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []),
  ])].slice(0, 3);
  return { replies: turns.filter((t) => t.role === 'assistant' && !isStage(text(t))).length, openQuestion, asked, askedTwice, sent, gave };
}

/**
 * The separate things ONE customer message asks. "Mấy giờ đóng cửa, và có cần
 * hẹn trước không?" is two questions in one sentence; the assistant answered
 * the hours, asked for a day, and never said whether an appointment is needed
 * (golden run, 18/11/2026). Returned only when there are two or more.
 */
export function partsAsked(message: string): string[] {
  const m = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (m.length < 12 || m.length > 600) return [];
  const sentences = m.split(/(?<=[?？!.])\s+/).map((x) => x.trim()).filter(Boolean);
  const asks = sentences.filter((x) => /[?？]$/.test(x) || sentences.length === 1);
  const parts = asks.flatMap((x) => x.split(/\s*[,;]\s*(?:và|and|còn|với lại|also|plus)\s+|\s+(?:và|and)\s+(?=(?:có|bên|tiệm|giá|mấy|khi|bao|ở|do|does|is|are|can|how|what|when|where|which|who)\b)/i)).map((x) => x.replace(/[?？.!\s]+$/, '').trim()).filter((x) => x.length >= 6);
  // One sentence with no question mark and no question word is a statement, not two questions.
  if (parts.length < 2) return [];
  if (!/[?？]/.test(m) && !/\b(không|ko|chưa|mấy|bao nhiêu|ở đâu|khi nào|how|what|when|where|which|do you|can i|is it|are you)\b/i.test(m)) return [];
  return parts.slice(0, 4).map((x) => cut(x, 120));
}

/** Said next to the customer's message when it asks more than one thing. '' otherwise. */
export function partsBlock(message: string): string {
  const parts = partsAsked(message);
  if (parts.length < 2) return '';
  return `\nTHE CUSTOMER'S NEW MESSAGE ASKS ${parts.length} THINGS — answer EVERY one, in the order asked, before any question of your own (one short sentence each; for a part you cannot answer from what you were given, say the team will check that part):\n${parts.map((x, i) => `${i + 1}. «${x}»`).join('\n')}`;
}

/** The ledger as the model reads it. '' on a first message — there is nothing to remember yet. */
export function chatStateBlock(history: StateTurn[] | null | undefined, o: { gapDays?: number } = {}): string {
  const s = chatState(history);
  if (!s.replies) return '';
  // After days of silence a greeting is right again (the gap note says so); within one sitting it is not.
  const lines: string[] = (o.gapDays ?? 0) >= 1 ? [`- You have replied ${s.replies} time${s.replies === 1 ? '' : 's'} in this chat before: the customer knows who you are — do not introduce yourself again.`]
    : [`- You have already replied ${s.replies} time${s.replies === 1 ? '' : 's'} in this chat: do not greet again, do not introduce yourself again, and do not restart the conversation.`];
  if (s.openQuestion) lines.push(`- Your last message ended with this question: «${s.openQuestion}» — read the customer's new message as their ANSWER to it first (a short "yes", "ok", a name, a time, a number is that answer). Act on it; never ask it again.`);
  if (s.asked.length) lines.push(`- Questions you already asked earlier: ${s.asked.map((q) => `«${q}»`).join(' · ')}. The answers are in the conversation above — use them; ask none of these again.`);
  if (s.askedTwice.length) lines.push(`- Asked TWICE already and not to be asked a third time: ${s.askedTwice.map((q) => `«${q}»`).join(' · ')}. If the customer still has not answered, carry on without it or offer a person.`);
  if (s.gave.length) lines.push(`- The customer already typed: ${s.gave.join(', ')} — never ask for it again.`);
  if (s.sent.length) lines.push(`- Already sent in this chat: ${s.sent.map((x) => (x === 'photos' ? 'photos' : 'a link')).join(', ')}. Send the same thing again only when the customer asks for it.`);
  return `\nWHERE THIS CONVERSATION STANDS (read from the transcript by the system — it is exact):\n${lines.join('\n')}`;
}
