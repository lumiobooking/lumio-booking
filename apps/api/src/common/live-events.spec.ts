import { liveEvents, LiveEvent } from './live-events';

describe('liveEvents — the nudge bus', () => {
  it('delivers a topic to a listener of the same tenant only', () => {
    const got: LiveEvent[] = [];
    const other: LiveEvent[] = [];
    const a = liveEvents.stream('t1').subscribe((e) => got.push(e));
    const b = liveEvents.stream('t2').subscribe((e) => other.push(e));
    liveEvents.emit('t1', 'walkins', 'w1');
    expect(got.map((e) => [e.topic, e.id])).toEqual([['walkins', 'w1']]);
    expect(other).toEqual([]);
    a.unsubscribe(); b.unsubscribe();
  });

  it('is a no-op with nobody listening and with no tenant', () => {
    expect(() => liveEvents.emit('nobody', 'walkins')).not.toThrow();
    expect(() => liveEvents.emit(null, 'walkins')).not.toThrow();
    expect(() => liveEvents.emit(undefined, 'walkins')).not.toThrow();
  });

  it('counts listeners and forgets a tenant when the last one leaves', () => {
    const a = liveEvents.stream('t3').subscribe(() => undefined);
    const b = liveEvents.stream('t3').subscribe(() => undefined);
    expect(liveEvents.listening('t3')).toBe(2);
    a.unsubscribe();
    expect(liveEvents.listening('t3')).toBe(1);
    b.unsubscribe();
    expect(liveEvents.listening('t3')).toBe(0);
    // A later emit after everyone left must not resurrect anything or throw.
    expect(() => liveEvents.emit('t3', 'walkins')).not.toThrow();
    expect(liveEvents.listening('t3')).toBe(0);
  });

  it('stamps the time', () => {
    const got: LiveEvent[] = [];
    const s = liveEvents.stream('t4').subscribe((e) => got.push(e));
    const before = Date.now();
    liveEvents.emit('t4', 'walkins');
    expect(got[0].at).toBeGreaterThanOrEqual(before);
    s.unsubscribe();
  });
});
