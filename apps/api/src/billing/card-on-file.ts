/**
 * A CARD THE SALON SAVED — the rules around it, with no network and no database.
 *
 * The card itself is held by the gateway (PayPal Vault or Stripe); Lumio keeps
 * a token and what a receipt prints. Everything that decides something lives
 * here so it can be tested: which gateway a new card goes to, what the saved
 * card is called on screen, how a plan change is priced mid-month, and when
 * the first charge after adding a card is due.
 */

import { pickGateway, type Gateway, type GatewaysEnabled } from './gateway-choice';

export interface CardMeta {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface SavedCard extends CardMeta {
  id: string;
  provider: Gateway;
  status: 'active' | 'removed' | 'failed';
  lastChargeAt: string | null;
  lastError: string | null;
}

/** "Visa •••• 4242 · 12/27" — the one line the billing screen prints. */
export function cardLabel(c: CardMeta | null | undefined): string {
  if (!c) return '';
  const brand = (c.brand ?? 'Card').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const last = c.last4 ? ` •••• ${c.last4}` : '';
  const exp = c.expMonth && c.expYear ? ` · ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '';
  return `${brand}${last}${exp}`;
}

/** PayPal's payment-token answer → what we keep. Brand/last digits/expiry only. */
export function cardMetaFromPaypal(src: unknown): CardMeta {
  const card = ((src as { payment_source?: { card?: Record<string, unknown> } })?.payment_source?.card ?? {}) as Record<string, unknown>;
  const exp = String(card.expiry ?? ''); // "2027-12"
  const m = exp.match(/^(\d{4})-(\d{2})$/);
  return {
    brand: card.brand ? String(card.brand) : null,
    last4: card.last_digits ? String(card.last_digits) : null,
    expMonth: m ? Number(m[2]) : null,
    expYear: m ? Number(m[1]) : null,
  };
}

/** Stripe's PaymentMethod → the same shape. */
export function cardMetaFromStripe(src: unknown): CardMeta {
  const card = ((src as { card?: Record<string, unknown> })?.card ?? {}) as Record<string, unknown>;
  return {
    brand: card.brand ? String(card.brand) : null,
    last4: card.last4 ? String(card.last4) : null,
    expMonth: Number.isFinite(Number(card.exp_month)) ? Number(card.exp_month) : null,
    expYear: Number.isFinite(Number(card.exp_year)) ? Number(card.exp_year) : null,
  };
}

/**
 * Which gateway a NEW card goes to — the platform's preference among the
 * configured ones (gateway-choice), unless the salon asked for one that is on.
 * A card form needs the gateway's PUBLIC key too; without it the gateway is
 * not usable for an in-page form even when its secret is set.
 */
export function gatewayForNewCard(enabled: GatewaysEnabled & { stripePublic: boolean; paypalClient: boolean }, asked?: Gateway | null): Gateway | null {
  const usable: GatewaysEnabled = { stripe: enabled.stripe && enabled.stripePublic, paypal: enabled.paypal && enabled.paypalClient };
  return pickGateway(usable, asked);
}

/**
 * Charge now for the rest of the current period when the salon moves UP a
 * plan: the price difference, pro-rated by the days left. Nothing for a move
 * down (the lower price starts at the next renewal) or when nothing is left
 * of the period.
 */
export function prorateCents(oldMonthlyCents: number, newMonthlyCents: number, accessUntil: Date | null, now: Date): number {
  if (!accessUntil || accessUntil.getTime() <= now.getTime()) return 0;
  const diff = newMonthlyCents - oldMonthlyCents;
  if (diff <= 0) return 0;
  const daysLeft = Math.min(31, Math.ceil((accessUntil.getTime() - now.getTime()) / 86_400_000));
  return Math.round((diff * daysLeft) / 30);
}

/**
 * Is the next monthly charge due? Due when access has ended, or ends within
 * the next three days — the same window the renewal scheduler uses, so the
 * card is charged a little before the lights would go out.
 */
export function renewalDue(accessUntil: Date | null, now: Date, graceDays = 3): boolean {
  if (!accessUntil) return true;
  return accessUntil.getTime() - now.getTime() <= graceDays * 86_400_000;
}

/** The period a renewal charged now covers: from the later of now / accessUntil, one month. */
export function nextPeriod(accessUntil: Date | null, now: Date): { start: Date; end: Date } {
  const start = accessUntil && accessUntil.getTime() > now.getTime() ? new Date(accessUntil) : new Date(now);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

/** What a declined charge is called on screen — the gateway's words, trimmed. */
export function declineText(raw: string | null | undefined, vi = true): string {
  const e = (raw ?? '').trim();
  if (!e) return vi ? 'Thẻ bị từ chối.' : 'The card was declined.';
  const low = e.toLowerCase();
  if (low.includes('insufficient')) return vi ? 'Thẻ không đủ tiền.' : 'Insufficient funds.';
  if (low.includes('expired')) return vi ? 'Thẻ đã hết hạn — cập nhật thẻ mới.' : 'The card has expired — add a new card.';
  if (low.includes('authentication') || low.includes('3ds')) return vi ? 'Ngân hàng yêu cầu xác thực — thêm lại thẻ để xác nhận.' : 'The bank asked for authentication — add the card again to confirm.';
  return e.slice(0, 160);
}
