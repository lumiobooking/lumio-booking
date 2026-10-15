/**
 * In-process billing events, so the card service (BillingModule) can tell
 * the invoices (InvoicesModule, which imports BillingModule) that something
 * happened without the two modules importing each other.
 *
 * Same shape as messenger/bot-refresh.ts: emit never throws, listeners are
 * best-effort, nothing is awaited.
 */
import { EventEmitter } from 'events';

export type BillingEvent = 'card_added';

const bus = new EventEmitter();
bus.setMaxListeners(20);

export function emitBillingEvent(event: BillingEvent, tenantId: string): void {
  try { bus.emit(event, tenantId); } catch { /* listeners are best-effort */ }
}

export function onBillingEvent(event: BillingEvent, fn: (tenantId: string) => void): () => void {
  bus.on(event, fn);
  return () => bus.off(event, fn);
}
