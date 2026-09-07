import type { DayPlan, Job, JobKind } from './weekly-plan';
import { isBi, type Txt } from './i18n';
import { SHOP_JOB_KINDS } from './client-view';

/**
 * The shop's edit, translated into the team's.
 *
 * The shop's screen shows the week as a flat list of jobs with ids (see
 * client-view). Its edit comes back the same way: "this job now says X",
 * "move this one to Thursday", "drop this", "add a photo job on Saturday".
 * That is turned here into the shape the team's editor sends — the seven
 * days, each job addressed by where it was — and handed to the same
 * `sanitizeDays` the team's edit goes through. One rebuild path, not two.
 *
 * What the shop can change: the instruction and the steps of any job, the
 * day of any job, whether a job exists, and it can add jobs of the kinds it
 * does with its own hands. What it cannot reach, because there is no field
 * for it here: the caption, the hashtags, the channel, the reasoning.
 */

export interface ShopJobPatch {
  id: string;
  text?: string;
  steps?: string[];
  dayIndex?: number;
  remove?: boolean;
}

export interface ShopWeekPatch {
  jobs?: ShopJobPatch[];
  add?: { dayIndex: number; kind: string; text: string }[];
}

export const MAX_SHOP_ADDS = 7;

/**
 * One job as the team's editor would send it. The reasoning and the timing
 * are handed back whole — they never reached the shop, so the shop cannot
 * have changed them, and the sanitiser drops a job whose text is missing
 * and blanks a `why` that is.
 */
interface RawOut { from?: string; kind?: JobKind; text?: Txt; why?: Txt; when?: Txt; brief?: { steps: string[] } }

const str = (v: unknown, cap: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

/** The shop's patch as the seven days the team's sanitiser expects. Null when nothing changed. */
export function shopPatchToDays(base: DayPlan[], patch: ShopWeekPatch): { jobs: RawOut[] }[] | null {
  const n = base.length;
  if (!n) return null;
  const byId = new Map<string, ShopJobPatch>();
  for (const p of Array.isArray(patch?.jobs) ? patch.jobs : []) {
    const id = str(p?.id, 24);
    if (id) byId.set(id, p);
  }
  const adds = (Array.isArray(patch?.add) ? patch.add : []).slice(0, MAX_SHOP_ADDS);
  if (!byId.size && !adds.length) return null;

  const out: { jobs: RawOut[] }[] = base.map(() => ({ jobs: [] }));
  let changed = false;
  base.forEach((day, di) => {
    (day.jobs ?? []).forEach((j: Job, ji) => {
      const from = `${di}:${ji}`;
      if (j.kind === 'rest') return; // rest markers are re-derived for an emptied day
      const asWas: RawOut = { from, kind: j.kind, text: j.text, why: j.why };
      if (j.when) asWas.when = j.when;
      const p = j.id ? byId.get(j.id) : undefined;
      if (!p) { out[di].jobs.push(asWas); return; }
      if (p.remove) { changed = true; return; }
      const to = Number.isInteger(p.dayIndex) && (p.dayIndex as number) >= 0 && (p.dayIndex as number) < n ? (p.dayIndex as number) : di;
      const raw: RawOut = { ...asWas };
      const text = p.text !== undefined ? str(p.text, 200) : '';
      if (text && text !== (isBi(j.text) ? j.text.vi : String(j.text)) && text !== (isBi(j.text) ? j.text.en : '')) { raw.text = text; changed = true; }
      if (Array.isArray(p.steps)) {
        const steps = p.steps.map((s) => str(s, 200)).filter(Boolean).slice(0, 12);
        raw.brief = { steps };
        changed = true;
      }
      if (to !== di) changed = true;
      out[to].jobs.push(raw);
    });
  });
  for (const a of adds) {
    const kind = SHOP_JOB_KINDS.includes(a?.kind as JobKind) ? (a.kind as JobKind) : null;
    const text = str(a?.text, 200);
    const di = Number.isInteger(a?.dayIndex) && a.dayIndex >= 0 && a.dayIndex < n ? a.dayIndex : null;
    if (!kind || !text || di === null) continue;
    out[di].jobs.push({ kind, text });
    changed = true;
  }
  return changed ? out : null;
}
