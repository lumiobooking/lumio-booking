import { PROBE_PNG, probeName } from './storage-probe';

describe('storage probe', () => {
  it('is a real PNG, so the host serves it as image/png', () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect([...PROBE_PNG.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // ...and it ends with the IEND chunk, i.e. it is complete, not truncated.
    expect(PROBE_PNG.subarray(PROBE_PNG.length - 8).toString('latin1')).toBe('IEND\xaeB`\x82');
  });

  it('is named as an image, never as text', () => {
    // REGRESSION: a .txt probe is served as text/plain and the image check
    // then reports a working host as broken.
    expect(probeName('abc')).toBe('lumio-check-abc.png');
    expect(probeName('abc')).not.toMatch(/\.txt$/);
  });
});
