/**
 * "After any change in the system the AI must learn it and answer customers."
 *
 * The bot never caches a salon's facts — every reply reads the services,
 * prices, hours, rules and bot facts fresh — so a change is live on the NEXT
 * message. What used to be missing is the customers already waiting: the one
 * the bot told "I'll check with the salon", and the one nobody answered. This
 * bus carries "salon X changed something" from wherever the change is saved
 * (the audit log is the one place almost every save passes through) to the
 * bot, which re-reads those open conversations and answers them.
 */
import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(20);

/** Audit actions that change what the bot would say. */
const RELEVANT = /^(service|service_addon|service_category|menu|settings\.(ai_notes|booking|business_profile|company|date_discounts|deposit|first_visit_discount|group_discount|industry|loyalty|no_show_policy|party_deposit|payments)|promotion|promo|staff|working_hours|hours|messenger\.(settings|knowledge_gap_answered|turn|facts)|walkin|turn_rules)/;

export function botRelevantAction(action: string): boolean {
  return RELEVANT.test(action);
}

/** Tell the bot that a salon's data changed. Cheap, never throws, never awaited. */
export function requestBotCatchUp(tenantId: string | null | undefined, reason: string): void {
  if (!tenantId) return;
  try { bus.emit('catchup', tenantId, reason); } catch { /* listeners are best-effort */ }
}

export function onBotCatchUp(fn: (tenantId: string, reason: string) => void): () => void {
  bus.on('catchup', fn);
  return () => bus.off('catchup', fn);
}
