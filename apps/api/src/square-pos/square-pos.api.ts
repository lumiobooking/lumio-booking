/**
 * The few Square calls the POS sync makes, with the salon's own access token
 * (the one saved on the Payment terminals page). Read-mostly: the only writes
 * are adding a customer and adding menu items to the salon's own Square
 * account — never a payment, never a refund.
 */
import { randomUUID } from 'crypto';
import { httpJson } from '../payments-hub/connectors/http.util';
import type { SqOrder, SqPayment, SqRefund } from './square-pos.logic';

const BASE = 'https://connect.squareup.com';
const VERSION = '2025-01-23';
const MAX_PAGES = 20;

export class SquareError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class SquarePosApi {
  constructor(private readonly token: string, private readonly locationId?: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Square-Version': VERSION };
  }

  private async call(method: string, path: string, body?: unknown) {
    const r = await httpJson(method, `${BASE}${path}`, this.headers(), body);
    if (!r.ok) {
      const e = r.json?.errors?.[0];
      throw new SquareError(e?.detail || e?.code || `Square error (HTTP ${r.status})`, r.status);
    }
    return r.json ?? {};
  }

  private qs(p: Record<string, string | undefined>) {
    const parts = Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  }

  /** The salon's locations; the first one when the connection names none. */
  async location(): Promise<{ id: string; currency: string } | null> {
    const j = await this.call('GET', '/v2/locations');
    const locs: { id: string; currency?: string; status?: string }[] = j.locations ?? [];
    const l = (this.locationId && locs.find((x) => x.id === this.locationId)) || locs.find((x) => x.status === 'ACTIVE') || locs[0];
    return l ? { id: l.id, currency: (l.currency || 'USD').toUpperCase() } : null;
  }

  async payments(from: Date, to: Date, locationId: string): Promise<{ payments: SqPayment[]; complete: boolean }> {
    const out: SqPayment[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await this.call('GET', `/v2/payments${this.qs({ begin_time: from.toISOString(), end_time: to.toISOString(), sort_order: 'ASC', location_id: locationId, limit: '100', cursor })}`);
      out.push(...((j.payments ?? []) as SqPayment[]));
      cursor = j.cursor;
      if (!cursor) return { payments: out, complete: true };
    }
    return { payments: out, complete: false };
  }

  async orders(ids: string[], locationId: string): Promise<SqOrder[]> {
    const out: SqOrder[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const j = await this.call('POST', '/v2/orders/batch-retrieve', { location_id: locationId, order_ids: ids.slice(i, i + 100) });
      out.push(...((j.orders ?? []) as SqOrder[]));
    }
    return out;
  }

  async customer(id: string): Promise<{ phone: string | null; firstName: string | null; lastName: string | null } | null> {
    try {
      const c = (await this.call('GET', `/v2/customers/${encodeURIComponent(id)}`)).customer ?? {};
      return { phone: c.phone_number ?? null, firstName: c.given_name ?? null, lastName: c.family_name ?? null };
    } catch { return null; }
  }

  async payment(id: string): Promise<SqPayment | null> {
    try { return ((await this.call('GET', `/v2/payments/${encodeURIComponent(id)}`)).payment ?? null) as SqPayment | null; } catch { return null; }
  }

  async refunds(from: Date, to: Date, locationId: string): Promise<SqRefund[]> {
    const out: SqRefund[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await this.call('GET', `/v2/refunds${this.qs({ begin_time: from.toISOString(), end_time: to.toISOString(), sort_order: 'ASC', location_id: locationId, limit: '100', cursor })}`);
      out.push(...((j.refunds ?? []) as SqRefund[]));
      cursor = j.cursor;
      if (!cursor) break;
    }
    return out;
  }

  async teamMembers(locationId: string): Promise<{ id: string; name: string }[]> {
    const j = await this.call('POST', '/v2/team-members/search', { query: { filter: { location_ids: [locationId], status: 'ACTIVE' } }, limit: 200 });
    return ((j.team_members ?? []) as { id: string; given_name?: string; family_name?: string }[])
      .map((m) => ({ id: m.id, name: [m.given_name, m.family_name].filter(Boolean).join(' ') || m.id }));
  }

  /** Add a client to Square's customer list unless one with this phone is there. */
  async ensureCustomer(c: { phone: string; firstName: string; lastName: string | null }): Promise<'found' | 'created'> {
    const found = await this.call('POST', '/v2/customers/search', { query: { filter: { phone_number: { exact: c.phone } } }, limit: 1 });
    if ((found.customers ?? []).length) return 'found';
    await this.call('POST', '/v2/customers', {
      idempotency_key: randomUUID(),
      given_name: c.firstName.slice(0, 100),
      family_name: c.lastName ? c.lastName.slice(0, 100) : undefined,
      phone_number: c.phone,
      note: 'Added by Lumio Booking',
    });
    return 'created';
  }

  async itemNames(): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const j = await this.call('GET', `/v2/catalog/list${this.qs({ types: 'ITEM', cursor })}`);
      for (const o of j.objects ?? []) if (o?.item_data?.name) names.push(String(o.item_data.name));
      cursor = j.cursor;
      if (!cursor) break;
    }
    return names;
  }

  async upsertItems(objects: unknown[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < objects.length; i += 500) {
      const batch = objects.slice(i, i + 500);
      await this.call('POST', '/v2/catalog/batch-upsert', { idempotency_key: randomUUID(), batches: [{ objects: batch }] });
      n += batch.length;
    }
    return n;
  }
}
