import { evidenceForDay, autoDone, mergeTicks } from './auto-ticks';

const post = (o: Partial<import('./auto-ticks').PostEvidence>) => ({
  day: '2026-09-10', status: 'scheduled', mediaCount: 1, hasVideo: false, hasMessage: true, ...o,
});

describe('evidenceForDay', () => {
  it('reads only that day, and only posts that are alive', () => {
    const ev = evidenceForDay([post({ day: '2026-09-09' }), post({ status: 'cancelled' }), post({ status: 'draft' })], '2026-09-10');
    expect(ev).toEqual({ scheduled: false, media: false, video: false, caption: false, posted: false });
  });

  it('takes the strongest post of the day', () => {
    const ev = evidenceForDay([post({ mediaCount: 0, hasMessage: false }), post({ hasVideo: true, status: 'posted' })], '2026-09-10');
    expect(ev).toEqual({ scheduled: true, media: true, video: true, caption: true, posted: true });
  });
});

describe('autoDone', () => {
  const auto = { 0: 'video' as const, 2: 'caption' as const, 3: 'posted' as const };

  it('TICKS THE CLIP, THE CAPTION AND THE PUBLISH once the queue proves them', () => {
    const ev = evidenceForDay([post({ hasVideo: true, status: 'posted' })], '2026-09-10');
    expect(autoDone(auto, ev)).toEqual([0, 2, 3]);
  });

  it('ticks the caption once scheduled, the publish only once posted', () => {
    const ev = evidenceForDay([post({ hasVideo: true })], '2026-09-10');
    expect(autoDone(auto, ev)).toEqual([0, 2]);
  });

  it('does not tick "pick the clip" for a photo post on a clip step', () => {
    const ev = evidenceForDay([post({ hasVideo: false })], '2026-09-10');
    expect(autoDone(auto, ev)).toEqual([2]);
  });

  it('leaves a sheet with no declarations to the person', () => {
    expect(autoDone(undefined, evidenceForDay([post({ status: 'posted' })], '2026-09-10'))).toEqual([]);
  });
});

describe('mergeTicks', () => {
  it('unions and sorts, so a person\'s untick never removes a machine tick', () => {
    expect(mergeTicks([4, 1], [2, 1])).toEqual([1, 2, 4]);
    expect(mergeTicks(undefined, [3])).toEqual([3]);
  });
});
