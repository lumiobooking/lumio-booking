import { liveTopicOf, tenantOfWrite } from './live-writes';

describe('which writes nudge which screens', () => {
  it('writes to the tables live screens show have a topic; reads and other tables do not', () => {
    expect(liveTopicOf({ model: 'Appointment', action: 'update' })).toBe('bookings');
    expect(liveTopicOf({ model: 'TableCheckLine', action: 'createMany' })).toBe('restaurant');
    expect(liveTopicOf({ model: 'DisplaySession', action: 'update' })).toBe('display');
    expect(liveTopicOf({ model: 'MenuItem', action: 'update' })).toBe('restaurant'); // sold out → guests' QR menus
    expect(liveTopicOf({ model: 'Appointment', action: 'findMany' })).toBeNull();
    expect(liveTopicOf({ model: 'AuditLog', action: 'create' })).toBeNull();
  });
  it('the tenant comes from the row written, else the filter, else the data — never guessed', () => {
    expect(tenantOfWrite({ args: {} }, { id: 'a', tenantId: 't1' })).toBe('t1');
    expect(tenantOfWrite({ args: { where: { tenantId: 't2', id: 'x' } } }, { count: 3 })).toBe('t2');
    expect(tenantOfWrite({ args: { data: [{ tenantId: 't3' }] } }, { count: 1 })).toBe('t3');
    expect(tenantOfWrite({ args: { create: { tenantId: 't4' } } }, null)).toBe('t4');
    expect(tenantOfWrite({ args: { where: { id: 'x' } } }, { count: 1 })).toBeNull();
  });
});

describe('a nudge reaches only its own salon', () => {
  it('salon A writing never wakes salon B, and nothing is sent without a tenant', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { liveEvents } = require('./live-events') as typeof import('./live-events');
    const a: string[] = []; const b: string[] = [];
    const sa = liveEvents.stream('tA').subscribe((e) => a.push(e.topic));
    const sb = liveEvents.stream('tB').subscribe((e) => b.push(e.topic));
    const write = { model: 'TableCheck', action: 'update', args: { where: { id: 'c1' } } };
    liveEvents.emit(tenantOfWrite(write, { id: 'c1', tenantId: 'tA' }), liveTopicOf(write)!);
    liveEvents.emit(tenantOfWrite({ args: { where: { id: 'x' } } }, { count: 1 }), 'bookings');
    sa.unsubscribe(); sb.unsubscribe();
    expect(a).toEqual(['restaurant']);
    expect(b).toEqual([]);
  });
});
