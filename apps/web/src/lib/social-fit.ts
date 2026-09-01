/**
 * Making a picture fit what Instagram will accept, before it is uploaded.
 *
 * WHY THIS IS NOT AN EDGE CASE
 *
 * Instagram takes feed images between 4:5 (0.8, tall) and 1.91:1 (wide). A
 * photo taken holding a phone upright is 3:4 — 0.75 — which is ALREADY outside
 * that range. So it is not unusual pictures that get refused, it is the
 * ordinary ones: most of what a salon shoots on the floor.
 *
 * When the ratio is wrong the Graph API answers "Media ID is not available",
 * which names the container id and says nothing about the picture. Nobody has
 * ever debugged their way from that sentence to "your photo is too tall".
 *
 * CROP WHEN TOO TALL, PAD WHEN TOO WIDE
 *
 * These are opposite kinds of image and they deserve opposite treatment.
 *
 * A too-TALL image is nearly always a photograph, and the excess is floor,
 * ceiling or wall above and below the subject. Trimming it is what Instagram's
 * own app does when you import a portrait shot, so it is also what the person
 * expects to see. Cropping loses nothing anybody was looking at.
 *
 * A too-WIDE image is nearly always a graphic: a banner, a logo, a price list.
 * The meaning lives at the edges — that is where the shop name and the phone
 * number are. Cropping a logo to fit cuts words off, and a salon that finds its
 * own name sliced in half on its Instagram will not trust the tool again. So a
 * wide image is placed on a background instead, whole.
 *
 * Both operations are visible in the composer preview afterwards, because the
 * fitted picture IS the file that gets uploaded. Nothing is changed behind the
 * salon's back at publish time.
 */

/** Instagram's feed limits. Outside these the container is rejected. */
export const IG_MIN_RATIO = 4 / 5;      // 0.8 — tallest allowed
export const IG_MAX_RATIO = 1.91;       // widest allowed
/** Instagram renders at 1080; beyond ~1440 is bytes nobody sees. */
export const IG_MAX_SIDE = 1440;
/** Below this Instagram upscales, and it shows. */
export const IG_MIN_SIDE = 320;

export type FitAction = 'none' | 'crop' | 'pad' | 'upscale';

export interface FitPlan {
  action: FitAction;
  /** Canvas size to draw into. */
  width: number;
  height: number;
  /** Where the source image goes inside that canvas. */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  /** Said to the salon, so a changed picture is never a surprise. */
  note: string | null;
}

/**
 * Work out what to do with an image of this size. Pure arithmetic — no canvas,
 * no DOM, which is why the rules can be checked rather than eyeballed.
 */
export function planFit(srcW: number, srcH: number): FitPlan {
  const w = Math.max(1, Math.round(srcW));
  const h = Math.max(1, Math.round(srcH));
  const ratio = w / h;

  // ---- inside the range: touch nothing but the size ----
  if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) {
    const scale = Math.min(1, IG_MAX_SIDE / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));
    // Upscaling a small picture makes it soft; saying so beats doing it
    // silently and letting the salon wonder why their post looks blurry.
    const tooSmall = Math.min(outW, outH) < IG_MIN_SIDE;
    return {
      action: tooSmall ? 'upscale' : 'none',
      width: outW, height: outH, drawX: 0, drawY: 0, drawW: outW, drawH: outH,
      note: tooSmall
        ? `Ảnh hơi nhỏ (${outW}×${outH}). Instagram sẽ phóng to nên có thể hơi mờ.`
        : null,
    };
  }

  // ---- too tall: crop the top and bottom to 4:5 ----
  if (ratio < IG_MIN_RATIO) {
    const keepH = Math.round(w / IG_MIN_RATIO);
    const scale = Math.min(1, IG_MAX_SIDE / Math.max(w, keepH));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(keepH * scale));
    // Floors of 1: a source so extreme that the scaled height rounds to zero
    // would hand the canvas a zero-height draw, which silently produces a blank
    // picture rather than an error.
    const fullH = Math.max(1, Math.round(h * scale));
    return {
      action: 'crop',
      width: outW, height: outH,
      drawX: 0,
      // Centre the crop: the subject of a hand-held portrait sits in the middle
      // far more often than at either end.
      drawY: Math.round((outH - fullH) / 2),
      drawW: outW, drawH: fullH,
      note: 'Ảnh dọc quá khổ — đã cắt bớt trên dưới cho vừa Instagram (4:5).',
    };
  }

  // ---- too wide: letterbox onto a background, keep everything ----
  const boxH = Math.round(w / IG_MAX_RATIO);
  const scale = Math.min(1, IG_MAX_SIDE / w);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(boxH * scale));
  const imgH = Math.max(1, Math.round(h * scale));
  return {
    action: 'pad',
    width: outW, height: outH,
    drawX: 0,
    drawY: Math.round((outH - imgH) / 2),
    drawW: outW, drawH: imgH,
    note: 'Ảnh ngang quá khổ — đã thêm nền trên dưới thay vì cắt, để không mất chữ trong ảnh.',
  };
}

/** True when this picture would be refused as-is. */
export function needsFit(srcW: number, srcH: number): boolean {
  const r = Math.max(1, srcW) / Math.max(1, srcH);
  return r < IG_MIN_RATIO || r > IG_MAX_RATIO;
}
