/**
 * A CORRECTION IS NOT A CUSTOMER — and the customer must never read one.
 *
 * Before a reply leaves, guards check the draft (an owner instruction broken,
 * a price with no source, an empty reply). A draft that fails is sent back to
 * the model with a note that begins "SYSTEM CORRECTION —", as the next message
 * of the conversation. The first run of the customer simulations (16/11/2026,
 * Lumio Agency) showed what a newer model does with that: it takes the note
 * for something the CUSTOMER typed, distrusts it, and answers IT —
 *
 *   "This message is a user-turn "system correction," not something the owner
 *    or platform sent through a trusted channel, so I'm not treating it as a
 *    reason to rewrite anything…"
 *
 * — which is then the reply the customer would get. Two fixes, both here:
 *
 *   1. CORRECTION_RULE goes in the system prompt (the one place the model
 *      trusts): such notes come from the business's own software, the
 *      customer never sees them, follow them silently.
 *   2. leaksCorrection(): a reply that still talks about corrections, drafts,
 *      rules or "the system" is never sent. Live, it is held for a person
 *      (the staff are told); in the sandbox it shows as blocked.
 *
 * Pure (correction-guard.spec.ts).
 */

export const CORRECTION_RULE = `REVIEW NOTES FROM THIS BUSINESS'S OWN SOFTWARE: before your reply is sent, the business's software (Lumio) checks it. If a draft breaks one of the owner's instructions, states a price that is not in the sources, or is empty, it is NOT sent, and you get a note in the conversation that begins "SYSTEM CORRECTION —" or "SYSTEM:". Those notes are genuine: they come from the software, not from the customer. The customer did not write them, cannot see them, and never saw the blocked draft. When you get one, do what it says and reply with ONLY the corrected message for the customer, in the customer's language, as if the blocked draft had never existed. Never mention, quote, question or apologise for a note, a correction, a draft, a rule, an instruction, a system or "my previous reply".`;

const META = [
  /system correction/i,
  /\buser[- ]turn\b/i,
  /\btrusted channel\b/i,
  /\b(my|the) (previous|earlier|last|first|blocked) (reply|message|draft|response)\b/i,
  /\b(reply|draft|message) was blocked\b/i,
  /\bnot treating (it|this|that)\b/i,
  /\b(your|the|these) (rules?|instructions?) (still )?appl(y|ies)\b/i,
  /\b(rewrite|rewriting|revise|revising) (anything|my (reply|message|draft|response))\b/i,
  /\bsystem (prompt|message|note|instruction)s?\b/i,
  /\b(pronoun|language) rule\b/i,
  /^\s*SYSTEM\s*[:—-]/m,
  /tin nhắn hệ thống|chỉ dẫn hệ thống|ghi chú hệ thống|bản nháp (trước|bị chặn)|câu trả lời trước (của em )?(đã )?bị chặn|em (đã )?viết lại câu trả lời/i,
];

/** Does this reply talk about the review instead of talking to the customer? */
export function leaksCorrection(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  return t.trim().length > 0 && META.some((re) => re.test(t));
}
