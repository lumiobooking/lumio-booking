/**
 * The guest's QR-menu phone is nudged when ITS table changes — not when
 * another table, or another restaurant, does.
 */
import { firstValueFrom, take, toArray, timeout } from 'rxjs';
import { liveEvents } from '../common/live-events';
import { PublicTableController } from './public-table.controller';

function ctl(stamps: Record<string, string[]>, tenants: Record<string, string>) {
  const at: Record<string, number> = {};
  const svc = {
    guestStreamTenant: async (token: string) => { if (!tenants[token]) throw new Error('TABLE_NOT_FOUND'); return tenants[token]; },
    guestStamp: async (token: string) => { const list = stamps[token]; const i = Math.min(at[token] ?? 0, list.length - 1); at[token] = (at[token] ?? 0) + 1; return list[i]; },
  };
  return new PublicTableController(svc as never);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the guest table stream', () => {
  it('nudges when this table changes, stays quiet when the change is elsewhere', async () => {
    // Stamps read in order: initial, after nudge 1 (same → silent), after nudge 2 (changed → nudge).
    const c = ctl({ tokA: ['s0', 's0', 's1'] }, { tokA: 'tenantA' });
    const got = firstValueFrom(c.stream('tokA').pipe(take(1), toArray(), timeout(3000)));
    await wait(20);
    liveEvents.emit('tenantA', 'restaurant');            // another table changed: stamp unchanged
    await wait(400);
    liveEvents.emit('tenantB', 'restaurant');            // another restaurant: never even read
    await wait(400);
    liveEvents.emit('tenantA', 'restaurant');            // this table changed
    const events = await got;
    expect(events).toHaveLength(1);
    expect((events[0] as unknown as { data: { topic: string } }).data.topic).toBe('table');
  });

  it('ignores topics a guest screen does not show', async () => {
    const c = ctl({ tokA: ['s0', 's1'] }, { tokA: 'tenantA' });
    const seen: unknown[] = [];
    const sub = c.stream('tokA').subscribe((e) => seen.push(e));
    await wait(20);
    liveEvents.emit('tenantA', 'bookings');
    liveEvents.emit('tenantA', 'walkins');
    await wait(500);
    sub.unsubscribe();
    expect(seen).toEqual([]);
  });
});
