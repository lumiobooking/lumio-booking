/**
 * THE LIVE AI, WITHOUT A CUSTOMER.
 *
 * Until 18/11/2026 the scripted customers (ai-brain/simulations), the canary
 * that runs after every deploy and the owner's try-out screen all talked to a
 * SECOND, shorter implementation of the assistant (AiBrainService.sandbox) —
 * its own prompt, its own tools, its own loop. A change to the real one
 * (MessengerService.runAgent: the prompt customers actually get, every gate,
 * the owner's instructions, the model routing) was therefore never tested by
 * them: on 16/11 the canary passed 20/20 while every price reply on the
 * company's own page was being blocked and replaced.
 *
 * A dry run puts a scripted conversation through runAgent itself, on a
 * conversation that exists nowhere:
 *   - nothing is sent (no token, no recipient);
 *   - nothing is saved — a tool that DOES something answers with the words
 *     the real one would have answered, so the model's next sentence is the
 *     one a customer would have read, and that is what gets judged;
 *   - tools that only LOOK (the menu, the book, the price list) run for real,
 *     against this salon's own data;
 *   - the salon's counters (which instruction was used, the stronger model's
 *     daily allowance) are left alone.
 *
 * Pure here: what each doing-tool says in a test run.
 */

/** Tools that run for real in a dry run although they are not "read only": they touch nothing outside the run. */
const HARMLESS = new Set(['offer_choices']);
/** Tools that are let through to their own code, which sends nothing in a dry run (it still checks what it would send). */
const SELF_GUARDED = new Set(['send_package_card', 'send_price_cards', 'send_photos']);

const has = (v: unknown) => String(v ?? '').trim().length > 0;

/**
 * What a doing-tool answers in a dry run, or null when the tool runs its own
 * code (looking tools, the harmless ones, the ones that guard themselves).
 * The wording follows the real tools' answers so the model reacts the same way.
 */
/**
 * What save_lead tells the MODEL when there is no name yet. The model used to
 * answer the old one-line error as if the customer had said it: an upset
 * customer of two months was told "That's fine, I'll wait for your details"
 * (golden run, 18/11/2026). The same words live and dry.
 */
export const LEAD_NEEDS_NAME = 'NOT SAVED — the customer has not given a name yet. This line is a note from the system to you; the customer did not say it and cannot see it, so do not answer it (never "that\'s fine", "no problem", "I\'ll wait"). Reply to the customer\'s LAST message as they wrote it — if they are upset or complaining, say sorry sincerely first and say a person from the team will look into it — then ask for their name and the best phone number in one short question.';

export function dryToolResult(name: string, input: Record<string, unknown>): string | null {
  if (HARMLESS.has(name) || SELF_GUARDED.has(name)) return null;
  switch (name) {
    case 'create_booking':
      if (!has(input.phone)) return 'ERROR: A phone number is required to book.';
      return 'SUCCESS. Appointment created (id test-run). Confirm the day, time and service back warmly in one line. [TEST RUN — nothing was written to the calendar]';
    case 'reschedule_appointment':
      return 'SUCCESS. The appointment has been moved and the salon calendar is already updated. Confirm the new day and time back warmly in one line, and say a new confirmation is on the way. [TEST RUN — nothing was changed]';
    case 'cancel_appointment':
      return 'SUCCESS. The appointment is cancelled and the salon calendar is already updated. Confirm it warmly in one line and say they are welcome to book again any time. [TEST RUN — nothing was changed]';
    case 'save_contact':
      return 'SUCCESS. Contact saved — do not repeat it back or ask for it again; carry on with what they wanted.';
    case 'save_birthday':
      return 'SUCCESS. Birthday saved — thank the customer warmly and wish them a great day.';
    case 'save_lead':
      if (!has(input.name)) return LEAD_NEEDS_NAME;
      return 'SUCCESS. Lead saved — the team has been told. Thank them in one line and say someone will be in touch.';
    case 'request_callback':
      return 'NOTED for the salon. Tell the customer in ONE line that the team will get back to them shortly, then carry on with anything else they need.';
    default:
      return null;
  }
}

/** Does this tool write, book or send when it is NOT a dry run? (For the spec that keeps this list honest.) */
export function isDryCovered(name: string): boolean {
  return HARMLESS.has(name) || SELF_GUARDED.has(name) || dryToolResult(name, { phone: '1', name: 'x' }) !== null;
}

export type DryState = 'reply' | 'silent' | 'held' | 'error';
export interface DryRunResult {
  /** What the customer would have read ('' when nothing would be sent). */
  reply: string;
  state: DryState;
  /** Tools the run called, in order. */
  tools: string[];
  /** What those tools RETURNED ("name: result", trimmed) — facts the salon's own systems gave the assistant. */
  found: string[];
  /** Guards that changed or held a draft ("Vì sao AI trả lời vậy?"). */
  guards: string[];
  /** Drafts an owner's instruction stopped: "label rule ⇐ the draft" — the salon's own words, shown only to its own people and to support. */
  blocked?: string[];
  /** Tap buttons under the reply. */
  choices: string[];
  /** Package / price cards the run would have sent. */
  cards: { name: string; price: string; tag?: string; points?: string[] }[];
  /** Milliseconds the AI worked, and where they went (./turn-timing). */
  ms: number;
  steps: { p: number; m: number; j: number; k: number; n: number; r: number };
  error?: string;
}
