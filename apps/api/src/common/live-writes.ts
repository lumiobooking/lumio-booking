/**
 * EVERY WRITE THAT A LIVE SCREEN SHOWS NUDGES IT — from one place.
 *
 * Only the walk-in board and the technician's chair were nudged (by hand, in
 * their controllers). A booking made at the desk, online or by the AI reached
 * the calendar on its next 15-second poll — later still, because the browser
 * then answered that poll from its own 15-second memory. The restaurant floor,
 * the kitchen and the till polled every 4–12 s. "Realtime chậm."
 *
 * Now the database client itself tells the tenant's open screens which kind of
 * thing changed (common/live-events.ts) after any write to the tables those
 * screens show. It carries no data — a screen still reads through its own
 * authorised endpoint — and it never throws into the write.
 */
export const LIVE_TOPIC_OF_MODEL: Record<string, string> = {
  Appointment: 'bookings',
  Payment: 'payments',
  WalkIn: 'walkins',
  WaitlistEntry: 'waitlist',
  Order: 'orders',
  OrderPayment: 'orders',
  TableCheck: 'restaurant',
  TableCheckLine: 'restaurant',
  RestaurantTable: 'restaurant',
  // A dish sold out (or back) — the floor, the till and the guests' QR menus.
  MenuItem: 'restaurant',
  DisplaySession: 'display',
};

const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

type Params = { model?: string; action?: string; runInTransaction?: boolean; args?: { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> } };

/** The topic a write belongs to, or null when no live screen shows it. */
export function liveTopicOf(params: Params): string | null {
  if (!params?.model || !params.action || !WRITES.has(params.action)) return null;
  return LIVE_TOPIC_OF_MODEL[params.model] ?? null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Whose screens to nudge: the row written, else the filter, else the data. */
export function tenantOfWrite(params: Params, result: unknown): string | null {
  const r = result as { tenantId?: unknown } | null;
  if (r && typeof r === 'object' && !Array.isArray(r)) { const t = str(r.tenantId); if (t) return t; }
  const where = params?.args?.where as { tenantId?: unknown } | undefined;
  const w = str(where?.tenantId);
  if (w) return w;
  const data = params?.args?.data as { tenantId?: unknown } | { tenantId?: unknown }[] | undefined;
  if (Array.isArray(data)) return str(data[0]?.tenantId);
  const d = str((data as { tenantId?: unknown } | undefined)?.tenantId);
  if (d) return d;
  return str(params?.args?.create?.tenantId);
}
