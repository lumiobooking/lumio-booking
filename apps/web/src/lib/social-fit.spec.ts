import {
  planFit, needsFit, IG_MIN_RATIO, IG_MAX_RATIO, IG_MAX_SIDE, IG_MIN_SIDE,
} from './social-fit';

const ratio = (p: { width: number; height: number }) => p.width / p.height;

describe('the ordinary photo is the one that gets refused', () => {
  it('knows a phone portrait (3:4) is already too tall for Instagram', () => {
    // This is the whole reason the file exists. 3:4 is 0.75, and Instagram's
    // floor is 0.8 — so the commonest shot a salon takes is out of range, and
    // the API answers "Media ID is not available", which names the container
    // and says nothing about the picture.
    expect(needsFit(1200, 1600)).toBe(true);
    expect(planFit(1200, 1600).action).toBe('crop');
  });

  it('knows a phone portrait held tall (9:16) is far outside', () => {
    expect(planFit(1080, 1920).action).toBe('crop');
  });

  it('leaves a square alone', () => {
    const p = planFit(1080, 1080);
    expect(p.action).toBe('none');
    expect(p.note).toBeNull();
  });

  it('leaves a landscape photo (4:3) alone', () => {
    expect(planFit(1600, 1200).action).toBe('none');
  });

  it.each([
    [800, 1000], // exactly 4:5
    [1910, 1000], // exactly 1.91:1
  ])('accepts %ix%i, which sits exactly on the limit', (w, h) => {
    expect(needsFit(w, h)).toBe(false);
    expect(planFit(w, h).action).toBe('none');
  });
});

describe('too tall is cropped, because the excess is floor and ceiling', () => {
  const p = planFit(1200, 1600);

  it('lands exactly on 4:5', () => {
    expect(ratio(p)).toBeCloseTo(IG_MIN_RATIO, 2);
  });

  it('centres the crop', () => {
    // The subject of a hand-held portrait sits in the middle far more often
    // than at either end.
    const above = -p.drawY;
    const below = p.drawH + p.drawY - p.height;
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  it('keeps the full width — nothing is lost sideways', () => {
    expect(p.drawW).toBe(p.width);
  });

  it('says what it did', () => {
    expect(p.note).toMatch(/cắt bớt trên dưới/);
  });
});

describe('too wide is padded, because the meaning is at the edges', () => {
  // A wide image is nearly always a graphic: a banner, a logo, a price list.
  // The shop name and the phone number live at the sides. Cropping a logo to
  // fit cuts words off, and a salon that finds its own name sliced in half will
  // not trust the tool again.
  const p = planFit(2000, 600);

  it('lands exactly on 1.91:1', () => {
    expect(ratio(p)).toBeCloseTo(IG_MAX_RATIO, 2);
  });

  it('keeps the WHOLE picture inside the frame', () => {
    expect(p.drawW).toBe(p.width);
    expect(p.drawH).toBeLessThanOrEqual(p.height);
    expect(p.drawY).toBeGreaterThanOrEqual(0);
  });

  it('centres it vertically', () => {
    expect(p.drawY * 2 + p.drawH).toBeCloseTo(p.height, 0);
  });

  it('says it padded rather than cropped, and why', () => {
    expect(p.note).toMatch(/thêm nền/);
    expect(p.note).toMatch(/không mất chữ/);
  });
});

describe('size, separately from shape', () => {
  it('never produces a side longer than the ceiling', () => {
    for (const [w, h] of [[4000, 3000], [3000, 4000], [6000, 2000], [1080, 1920]]) {
      const p = planFit(w, h);
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(IG_MAX_SIDE);
    }
  });

  it('does not shrink a picture that is already small', () => {
    const p = planFit(600, 600);
    expect(p.width).toBe(600);
    expect(p.height).toBe(600);
  });

  it('warns rather than silently upscaling a tiny picture', () => {
    // Doing it quietly leaves the salon wondering why their post looks blurry.
    const p = planFit(200, 200);
    expect(p.action).toBe('upscale');
    expect(p.note).toMatch(/hơi nhỏ/);
    expect(IG_MIN_SIDE).toBe(320);
  });
});

describe('it never returns something a canvas cannot draw', () => {
  it.each([
    [0, 0], [1, 0], [0, 1], [1, 1], [10000, 1], [1, 10000],
  ])('survives %ix%i', (w, h) => {
    const p = planFit(w, h);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
    expect(p.drawW).toBeGreaterThan(0);
    expect(p.drawH).toBeGreaterThan(0);
    expect(Number.isFinite(p.drawX)).toBe(true);
    expect(Number.isFinite(p.drawY)).toBe(true);
  });

  it('brings an extreme ratio back inside the range', () => {
    for (const [w, h] of [[10000, 1], [1, 10000], [5000, 100], [100, 5000]]) {
      const p = planFit(w, h);
      expect(ratio(p)).toBeGreaterThanOrEqual(IG_MIN_RATIO - 0.01);
      expect(ratio(p)).toBeLessThanOrEqual(IG_MAX_RATIO + 0.01);
    }
  });
});
