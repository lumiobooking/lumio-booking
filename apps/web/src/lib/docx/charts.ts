/**
 * The report's four charts, drawn on a <canvas> in the browser.
 *
 * Same visual grammar as the approved template: brand colors identify the
 * channel, no frames, no gridlines beyond one baseline, and every value is
 * annotated ON the chart — a chart the reader has to cross-reference with a
 * table is decoration, not information.
 *
 * Each painter returns null when the month doesn't have the data to earn the
 * chart (one data point is not a trend); the document builder then falls back
 * to its text note. Drawn at 2× and embedded at half size for print sharpness.
 */

import { ChartImage } from './report-docx';

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const NAVY = '#0f2a52'; const MUTED = '#64748b'; const HAIR = '#e3e8f2';

interface Ctx2 { cv: HTMLCanvasElement; g: CanvasRenderingContext2D }

function mk(w: number, h: number): Ctx2 | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return null;
  return { cv, g };
}

async function png(c: Ctx2, wCm: number): Promise<ChartImage | null> {
  const blob = await new Promise<Blob | null>((res) => c.cv.toBlob(res, 'image/png'));
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { png: buf, wCm, hCm: (wCm * c.cv.height) / c.cv.width };
}

const fnum = (n: number, vi: boolean) => n.toLocaleString(vi ? 'vi-VN' : 'en-US');

// ---- 1) views per platform --------------------------------------------------

export async function chartViews(items: { label: string; value: number; color: string }[], title: string, vi: boolean): Promise<ChartImage | null> {
  const rows = items.filter((x) => x.value != null && Number.isFinite(x.value));
  if (!rows.length || rows.every((x) => x.value === 0)) return null;
  const c = mk(1000, 430); if (!c) return null;
  const { g } = c;
  g.textAlign = 'center';
  g.fillStyle = NAVY; g.font = `700 30px ${FONT}`;
  g.fillText(title, 500, 44);
  const max = Math.max(...rows.map((x) => x.value), 1);
  const baseY = 360; const topY = 110; const bw = 120;
  const step = 1000 / (rows.length + 1);
  rows.forEach((x, i) => {
    const cx = step * (i + 1);
    const h = Math.max(4, ((baseY - topY) * x.value) / max);
    g.fillStyle = x.color;
    g.fillRect(cx - bw / 2, baseY - h, bw, h);
    g.fillStyle = NAVY; g.font = `700 26px ${FONT}`;
    g.fillText(fnum(x.value, vi), cx, baseY - h - 14);
    g.fillStyle = MUTED; g.font = `500 24px ${FONT}`;
    g.fillText(x.label, cx, baseY + 34);
  });
  g.strokeStyle = HAIR; g.lineWidth = 2;
  g.beginPath(); g.moveTo(60, baseY); g.lineTo(940, baseY); g.stroke();
  return png(c, 12.5);
}

// ---- 2) follower growth (two line panels) -----------------------------------

export interface GrowthSeries { name: string; color: string; values: number[]; months: string[] }

function linePanel(g: CanvasRenderingContext2D, x0: number, w: number, s: GrowthSeries, vi: boolean): void {
  const top = 60; const baseY = 300; const pad = 46;
  g.textAlign = 'left';
  g.fillStyle = s.color; g.font = `700 28px ${FONT}`;
  g.fillText(s.name, x0 + pad, 40);
  const arr = s.values;
  const mn = Math.min(...arr); const mx = Math.max(...arr); const sp = mx - mn || 1;
  const X = (i: number) => x0 + pad + (i / (arr.length - 1)) * (w - 2 * pad);
  const Y = (v: number) => top + 40 + (1 - (v - mn) / sp) * (baseY - top - 80);
  g.strokeStyle = HAIR; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0 + pad, baseY); g.lineTo(x0 + w - pad, baseY); g.stroke();
  g.beginPath();
  arr.forEach((v, i) => { if (i === 0) g.moveTo(X(i), Y(v)); else g.lineTo(X(i), Y(v)); });
  g.lineTo(X(arr.length - 1), baseY); g.lineTo(X(0), baseY); g.closePath();
  g.globalAlpha = 0.10; g.fillStyle = s.color; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = s.color; g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  arr.forEach((v, i) => { if (i === 0) g.moveTo(X(i), Y(v)); else g.lineTo(X(i), Y(v)); });
  g.stroke();
  for (const i of [0, arr.length - 1]) {
    g.fillStyle = s.color; g.beginPath(); g.arc(X(i), Y(arr[i]), 7, 0, Math.PI * 2); g.fill();
  }
  g.font = `700 24px ${FONT}`;
  g.fillStyle = MUTED; g.textAlign = 'left'; g.fillText(fnum(arr[0], vi), X(0) - 8, Y(arr[0]) - 16);
  g.fillStyle = s.color; g.textAlign = 'right'; g.fillText(fnum(arr[arr.length - 1], vi), X(arr.length - 1) + 10, Y(arr[arr.length - 1]) - 16);
  const mLb = (m: string) => (m && m.length >= 7 ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : m);
  g.fillStyle = MUTED; g.font = `500 22px ${FONT}`;
  g.textAlign = 'left'; g.fillText(mLb(s.months[0] || ''), x0 + pad, baseY + 32);
  g.textAlign = 'right'; g.fillText(mLb(s.months[s.months.length - 1] || ''), x0 + w - pad, baseY + 32);
}

export async function chartGrowth(series: GrowthSeries[], vi: boolean): Promise<ChartImage | null> {
  const ok = series.filter((s) => s.values.length >= 2);
  if (!ok.length) return null;
  const c = mk(1000, 350); if (!c) return null;
  const w = 1000 / ok.length;
  ok.forEach((s, i) => linePanel(c.g, i * w, w, s, vi));
  return png(c, 12.5);
}

// ---- 3) audience: gender donut + age bars -----------------------------------

export async function chartAudience(gender: Record<string, number> | undefined, age: Record<string, number> | undefined, vi: boolean): Promise<ChartImage | null> {
  const hasG = gender && Object.keys(gender).length > 0;
  const hasA = age && Object.keys(age).length > 0;
  if (!hasG && !hasA) return null;
  const c = mk(1200, 440); if (!c) return null;
  const { g } = c;
  const t = (v: string, e: string) => (vi ? v : e);
  if (hasG && gender) {
    const gt = Object.values(gender).reduce((a, b) => a + b, 0) || 1;
    const segs: [string, string, number][] = [
      [t('Nữ', 'Female'), '#e1306c', gender.F || 0],
      [t('Nam', 'Male'), '#3b82f6', gender.M || 0],
      [t('Khác', 'Other'), '#cbd5e1', gender.U || 0],
    ];
    g.textAlign = 'center'; g.fillStyle = NAVY; g.font = `700 28px ${FONT}`;
    g.fillText(t('Giới tính', 'Gender'), 210, 46);
    let a0 = -Math.PI / 2;
    for (const [, color, v] of segs) {
      const a1 = a0 + (v / gt) * Math.PI * 2;
      g.beginPath(); g.arc(210, 240, 120, a0, a1); g.strokeStyle = color; g.lineWidth = 58; g.stroke();
      a0 = a1;
    }
    g.textAlign = 'left'; g.font = `600 24px ${FONT}`;
    segs.forEach(([label, color, v], i) => {
      const y = 160 + i * 52;
      g.fillStyle = color; g.fillRect(392, y - 18, 22, 22);
      g.fillStyle = '#334155';
      g.fillText(`${label} ${Math.round((v / gt) * 1000) / 10}%`, 426, y);
    });
  }
  if (hasA && age) {
    const at = Object.values(age).reduce((a, b) => a + b, 0) || 1;
    const keys = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'].filter((k) => age[k] != null);
    g.textAlign = 'center'; g.fillStyle = NAVY; g.font = `700 28px ${FONT}`;
    g.fillText(t('Độ tuổi', 'Age'), 890, 46);
    const x0 = 720; const bw = 330;
    const rh = Math.min(46, 340 / Math.max(keys.length, 1));
    keys.forEach((k, i) => {
      const pct = Math.round(((age[k] || 0) / at) * 1000) / 10;
      const y = 90 + i * rh;
      g.textAlign = 'right'; g.fillStyle = MUTED; g.font = `500 22px ${FONT}`;
      g.fillText(k, x0 - 12, y + rh / 2 + 7);
      g.fillStyle = '#eef1f6'; g.fillRect(x0, y + rh / 2 - 11, bw, 22);
      g.fillStyle = '#6366f1'; g.fillRect(x0, y + rh / 2 - 11, Math.max(3, (bw * pct) / 100), 22);
      g.textAlign = 'left'; g.fillStyle = NAVY; g.font = `700 22px ${FONT}`;
      g.fillText(`${pct}%`, x0 + bw + 10, y + rh / 2 + 7);
    });
  }
  return png(c, 15);
}

// ---- 4) GBP: impressions trend + action rates -------------------------------

export async function chartGbp(series: { month: string; value: number }[], rates: { label: string; value: number | null; color: string }[], vi: boolean): Promise<ChartImage | null> {
  const hasTrend = series.length >= 2;
  const hasRates = rates.some((r) => r.value != null);
  if (!hasTrend && !hasRates) return null;
  const c = mk(1000, 360); if (!c) return null;
  const { g } = c;
  const t = (v: string, e: string) => (vi ? v : e);
  if (hasTrend) {
    linePanel(g, 0, hasRates ? 500 : 1000, {
      name: t('Lượt xem hồ sơ', 'Profile views'), color: '#1a73e8',
      values: series.map((s) => s.value), months: series.map((s) => s.month),
    }, vi);
  }
  if (hasRates) {
    const x0 = hasTrend ? 560 : 80; const bw = hasTrend ? 260 : 640;
    g.textAlign = 'left'; g.fillStyle = NAVY; g.font = `700 28px ${FONT}`;
    g.fillText(t('Tỷ lệ hành động', 'Action rates'), x0, 40);
    const rows = rates.filter((r) => r.value != null);
    const max = Math.max(...rows.map((r) => r.value || 0), 1);
    rows.forEach((r, i) => {
      const y = 100 + i * 70;
      g.textAlign = 'left'; g.fillStyle = '#475569'; g.font = `500 24px ${FONT}`;
      g.fillText(r.label, x0, y - 12);
      g.fillStyle = '#eef1f6'; g.fillRect(x0, y, bw, 26);
      g.fillStyle = r.color; g.fillRect(x0, y, Math.max(4, (bw * (r.value || 0)) / max), 26);
      g.fillStyle = NAVY; g.font = `700 24px ${FONT}`;
      g.fillText(`${r.value}%`, x0 + bw + 12, y + 21);
    });
  }
  return png(c, 12.5);
}
