/**
 * The till's drawn floor plan (sơ đồ thật): where each table sits, how big it
 * is, how many chairs it gets, and the area zones behind them. Pure.
 *
 * Tables placed on the owner's floor map (Tables › Floor map) keep their spot;
 * the rest are laid out by area underneath, so a restaurant that never
 * arranged anything still gets a usable plan. Zones are the box around each
 * area's tables — nothing new to store.
 */
import { spotTop, type Spot } from './till-floor';

export interface PlanTable { id: string; name: string; seats: number; area: string | null }
export interface Placed { id: string; area: string; x: number; y: number; w: number; h: number; round: boolean; top: number; bottom: number; boxW: number; boxH: number }
export interface Zone { area: string; x: number; y: number; w: number; h: number; tint: string }
export interface FloorPlan { tables: Placed[]; zones: Zone[]; width: number; height: number }

/** The plan's own width; the owner's x (a % of the map) is laid onto it. */
export const PLAN_W = 1200;
const CHAIR_ROW = 14; // 8 px chair + 6 px gap, above and below the table
const GAP = 48;
const PAD = 28;
const LABEL = 30;
const BLOCK_MAX = 760;
const ZONE_GAP = 18;
const TINTS = ['#f6f3ff', '#eef6ff', '#effbf3', '#fff7ed', '#fdf2f8', '#f1f5f9'];

/** A table's top, its chairs and the space it takes. */
export function tableShape(seats: number, shape?: Spot['shape'] | null): { w: number; h: number; round: boolean; top: number; bottom: number } {
  const n = Math.max(1, Math.min(20, Math.round(seats) || 1));
  const kind = shape ?? (n <= 2 ? 'round' : n <= 4 ? 'square' : 'long');
  const top = Math.ceil(n / 2);
  const bottom = Math.floor(n / 2);
  if (kind === 'round') { const d = n <= 2 ? 84 : 98; return { w: d, h: d, round: true, top: Math.min(top, 3), bottom: Math.min(bottom, 3) }; }
  if (kind === 'square') return { w: 116, h: 88, round: false, top: Math.min(top, 3), bottom: Math.min(bottom, 3) };
  return { w: Math.max(180, Math.min(320, 40 + 34 * top)), h: 82, round: false, top: Math.min(top, 8), bottom: Math.min(bottom, 8) };
}

function box(s: { w: number; h: number; top: number; bottom: number }): { boxW: number; boxH: number } {
  const chairs = Math.max(s.top, s.bottom);
  return { boxW: Math.max(s.w, chairs * 32 - 10), boxH: s.h + CHAIR_ROW * 2 };
}

export function planFloor(tables: PlanTable[], layout?: Record<string, Spot> | null): FloorPlan {
  const placed: Placed[] = [];
  const spots = layout ?? {};
  // 1. Tables the owner placed.
  for (const t of tables) {
    const sp = spots[t.id];
    if (!sp) continue;
    const s = tableShape(t.seats, sp.shape);
    const b = box(s);
    const x = Math.max(PAD, Math.min(PLAN_W - b.boxW - PAD, (sp.x / 100) * PLAN_W));
    placed.push({ id: t.id, area: t.area || '', x, y: spotTop(sp.y) + PAD + LABEL, ...s, ...b });
  }
  // 1b. The owner's rows sit ROW_PX apart, but a zone needs its label and
  //     padding round the tables: two areas on neighbouring rows drew their
  //     zones over each other and hid the area names (iPad, 5 Nov 2026).
  //     Areas are taken top to bottom; one whose zone would cover a zone
  //     already drawn moves down below it, keeping its own layout.
  separateZones(placed);
  // 2. The rest: each area laid out as its own block, blocks packed side by
  //    side (a small area does not take a whole row), under what is placed.
  const startY = placed.length ? Math.max(...placed.map((p) => p.y + p.boxH)) + GAP + PAD : 0;
  const rest = tables.filter((t) => !spots[t.id]);
  const blocks = [...new Set(rest.map((t) => t.area || ''))].sort((x, y) => x.localeCompare(y, 'vi', { numeric: true })).map((a) => {
    const items: Placed[] = [];
    let x = 0; let y = 0; let rowH = 0; let w = 0;
    for (const t of rest.filter((r) => (r.area || '') === a)) {
      const s = tableShape(t.seats);
      const b = box(s);
      if (x > 0 && x + b.boxW > BLOCK_MAX) { x = 0; y += rowH + GAP; rowH = 0; }
      items.push({ id: t.id, area: a, x, y, ...s, ...b });
      x += b.boxW + GAP;
      w = Math.max(w, x - GAP);
      rowH = Math.max(rowH, b.boxH);
    }
    return { items, w: w + PAD * 2, h: y + rowH + PAD * 2 + LABEL };
  });
  let bx = 8; let by = startY + 8; let shelf = 0;
  for (const bl of blocks) {
    if (bx > 8 && bx + bl.w > PLAN_W - 8) { bx = 8; by += shelf + ZONE_GAP; shelf = 0; }
    for (const it of bl.items) placed.push({ ...it, x: it.x + bx + PAD, y: it.y + by + PAD + LABEL });
    bx += bl.w + ZONE_GAP;
    shelf = Math.max(shelf, bl.h);
  }
  // 3. A zone around each area's tables.
  const zoneAreas = [...new Set(placed.map((p) => p.area))];
  const zones: Zone[] = zoneAreas.map((a, i) => ({ area: a, ...zoneBox(placed.filter((p) => p.area === a)), tint: TINTS[i % TINTS.length] }));
  const width = Math.max(600, ...zones.map((z) => z.x + z.w + 8));
  const height = Math.max(360, ...zones.map((z) => z.y + z.h + 8));
  return { tables: placed, zones, width, height };
}

/** The box behind a group of tables: padding round them, room for the area name on top. */
function zoneBox(ps: Placed[]): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(8, Math.min(...ps.map((p) => p.x)) - PAD);
  const y0 = Math.max(8, Math.min(...ps.map((p) => p.y)) - PAD - LABEL);
  const x1 = Math.max(...ps.map((p) => p.x + p.boxW)) + PAD;
  const y1 = Math.max(...ps.map((p) => p.y + p.boxH)) + PAD;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Moves whole areas down (in place) until no two area zones overlap. Top-most area first. */
export function separateZones(placed: Placed[]): void {
  const areas = [...new Set(placed.map((p) => p.area))]
    .map((a) => ({ a, top: Math.min(...placed.filter((p) => p.area === a).map((p) => p.y)) }))
    .sort((x, y) => x.top - y.top)
    .map((x) => x.a);
  const done: { x: number; y: number; w: number; h: number }[] = [];
  for (const a of areas) {
    const ps = placed.filter((p) => p.area === a);
    for (let guard = 0; guard < 50; guard++) {
      const z = zoneBox(ps);
      const hit = done.filter((d) => overlaps(z, d));
      if (!hit.length) break;
      const dy = Math.max(...hit.map((d) => d.y + d.h + ZONE_GAP)) - z.y;
      for (const p of ps) p.y += dy;
    }
    done.push(zoneBox(ps));
  }
}

/** How much to shrink the plan to fit a box (never enlarged; a phone keeps tables big enough to tap and scrolls). */
export function planScale(planWidth: number, boxWidth: number, phone: boolean): number {
  if (!(boxWidth > 0) || !(planWidth > 0)) return 1;
  const fit = Math.min(1, boxWidth / planWidth);
  return phone ? Math.max(0.62, fit) : Math.max(0.5, fit);
}
