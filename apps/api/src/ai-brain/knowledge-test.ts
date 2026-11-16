/**
 * "KIỂM TRA AI" — the way the large support AIs are made trustworthy (Intercom
 * Fin's Evals, Zowie's Supervisor): do not take the AI's word for it, test it.
 *
 *   1. Questions are written FROM the salon's own documents and notes, the way
 *      a customer would ask them, each with the answer the documents give —
 *      plus a few whose answer is NOT written anywhere, where the right reply
 *      is "the team will confirm", never a guess.
 *   2. Each question goes to the real assistant (the AI-brain sandbox: same
 *      documents, notes and owner rules as live, nothing written or sent).
 *   3. A judge compares every reply with the expected answer.
 *   4. Separately: old typed notes that CONTRADICT the documents are listed,
 *      because a stale note is the usual reason an AI answers wrong.
 *
 * Pure prompt text and parsing here; the calls live in AiBrainService.
 */

export interface TestQuestion { q: string; expect: string; kind: string }
export interface TestItem extends TestQuestion { reply: string; pass: boolean; why: string }
export interface Conflict { old: string; doc: string; why: string; n?: number; label?: string; off?: boolean }
export interface KnowledgeTest { at: string; ms: number; score: number; total: number; passed: number; items: TestItem[]; conflicts: Conflict[]; lang: 'vi' | 'en' }

export const TEST_KEY = 'ai_brain_test';
export const TEST_COUNT = 12;

/** Vietnamese when the material is written in Vietnamese. */
export function materialLang(text: string): 'vi' | 'en' {
  const t = String(text || '');
  const vi = (t.match(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) || []).length;
  const letters = (t.match(/\p{L}/gu) || []).length || 1;
  return vi / letters > 0.03 ? 'vi' : 'en';
}

/** The first JSON array in a model reply (models wrap JSON in prose or fences). */
export function jsonArray<T>(text: string): T[] {
  const s = String(text || '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function questionPrompt(material: string, lang: 'vi' | 'en', n = TEST_COUNT): { system: string; user: string } {
  return {
    system: `You write an exam that checks whether a business's customer-chat AI knows the business's own documents. Output ONLY a JSON array, no prose.`,
    user: `Here is everything the AI was given about the business:\n\n${material}\n\n`
      + `Write ${n} questions a real customer would send in chat, in ${lang === 'vi' ? 'Vietnamese (natural, the way a salon owner texts)' : 'English'}. Spread them over the WHOLE material, including sections near the end — not only the first part. Mix:\n`
      + `- exact price of a named package or item (and any one-time / setup fee)\n- what a package includes or how much of it (posts, videos, channels, pages…)\n- conditions: minimum commitment, discounts, what is NOT included\n- comparing two packages, or "which one has X"\n- 2 questions whose answer is NOT in the material (e.g. a discount or service that is not listed) — for those, "expect" is that the AI does not invent an answer and offers to have the team confirm.\n`
      + `Each item: {"q": the customer's message, "expect": the correct answer in one or two sentences with the exact figures and names from the material, "kind": "price"|"included"|"condition"|"compare"|"not_listed"}.`,
  };
}

export function judgePrompt(items: { q: string; expect: string; reply: string }[], lang: 'vi' | 'en', docs = ''): { system: string; user: string } {
  return {
    system: 'You grade a customer-chat AI strictly but fairly. Output ONLY a JSON array, no prose.',
    user: (docs ? `THE BUSINESS'S DOCUMENTS (the truth to judge by):\n${docs}\n\n` : '')
      + `For each test, compare the AI's reply with the expected answer${docs ? ' AND the documents' : ''}.\n`
      + `PASS when every figure, package name and condition the reply states is correct, and it answers what was asked (it may be shorter, may ask a follow-up question, may phrase things differently). A reply that only asks for contact details without answering a question the documents DO answer is a FAIL. For "not listed" questions, PASS only when the reply does not invent a figure or offer.\n`
      + `Extra details are FINE when the documents say them (an extra true feature, the price next to the package name, a polite follow-up question or an offer to take their contact). Do not fail a reply for adding true information.\n`
      + `FAIL on any wrong number, wrong package, invented discount/gift/feature/free offer, a claim the documents contradict, or a confident answer to something the documents do not say.\n\n`
      + items.map((t, i) => `#${i}\nCustomer: ${t.q}\nExpected: ${t.expect}\nAI reply: ${t.reply || '(no reply)'}`).join('\n\n')
      + `\n\nOutput: [{"i": number, "pass": true|false, "why": one short sentence in ${lang === 'vi' ? 'Vietnamese' : 'English'} naming exactly what is wrong (or "Đúng" / "Correct")}] — one entry per test.`,
  };
}

export function conflictPrompt(oldNotes: string, docs: string, lang: 'vi' | 'en'): { system: string; user: string } {
  return {
    system: 'You find contradictions between a business\'s old typed notes and its current documents. Output ONLY a JSON array, no prose.',
    user: `CURRENT DOCUMENTS (the truth):\n${docs}\n\nOLD TYPED NOTES:\n${oldNotes}\n\n`
      + `List every old note line that states something the documents contradict: a different price, a different amount, an offer or gift the documents say does not exist, a package that no longer exists. Ignore notes the documents simply do not mention. `
      + `Old notes are numbered [n]. Output: [{"n": the note's number, "old": the old note (quoted short), "doc": what the documents say instead (short, exact figures), "why": one short sentence in ${lang === 'vi' ? 'Vietnamese' : 'English'}}]. Output [] when there is none.`,
  };
}
