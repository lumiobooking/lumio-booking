'use client';

/**
 * One massage form, tap by tap: yes/no pills, chips, a body map, a 0–10
 * scale and "I understand" ticks. Draws the template the API sends
 * (api/src/client-forms/form-templates.ts) — nothing about the questions is
 * written here.
 *
 * Colours come in as a palette: the salon's app passes its theme tokens,
 * the client's own phone page passes plain paper colours.
 */
import type { CSSProperties } from 'react';
import type { Answers, ResolvedField, ResolvedTemplate } from '../../lib/client-forms';

export interface FormPalette {
  ink: string; sub: string; line: string; card: string; field: string;
  accent: string; onAccent: string; bad: string; badWash: string;
}

/** Inside the salon's app: follows light / dark. */
export const THEMED: FormPalette = {
  ink: 'var(--ce2e8f0)', sub: 'var(--c94a3b8)', line: 'var(--line)', card: 'var(--raised)', field: 'var(--raised)',
  accent: '#6366f1', onAccent: '#ffffff', bad: 'var(--ink-bad)', badWash: 'var(--wash-red)',
};

/** On the client's phone or the check-in iPad: always paper. */
export const PAPER: FormPalette = {
  ink: '#1f2937', sub: '#6b7280', line: '#e5e7eb', card: '#ffffff', field: '#f9fafb',
  accent: '#4f46e5', onAccent: '#ffffff', bad: '#b91c1c', badWash: '#fef2f2',
};

export function FormRenderer({ tpl, answers, onChange, palette, vi, missing, readOnly }: {
  tpl: ResolvedTemplate; answers: Answers; onChange: (next: Answers) => void; palette: FormPalette; vi: boolean;
  /** Ids to mark as still unanswered (after a refused submit). */
  missing?: string[]; readOnly?: boolean;
}) {
  const p = palette;
  const set = (id: string, v: unknown) => { if (!readOnly) onChange({ ...answers, [id]: v }); };
  const miss = new Set(missing ?? []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {tpl.fields.map((f) => {
        if (f.type === 'section') {
          return <div key={f.id} style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: p.sub, marginTop: 10 }}>{f.label}</div>;
        }
        if (f.type === 'note') return <div key={f.id} style={{ fontSize: 14, color: p.sub, lineHeight: 1.5 }}>{f.label}</div>;
        const box: CSSProperties = {
          border: `1px solid ${miss.has(f.id) ? p.bad : p.line}`, background: miss.has(f.id) ? p.badWash : p.card,
          borderRadius: 14, padding: '12px 14px',
        };
        return (
          <div key={f.id} style={box} data-field={f.id}>
            <FieldBody f={f} tpl={tpl} answers={answers} set={set} p={p} vi={vi} readOnly={!!readOnly} />
          </div>
        );
      })}
    </div>
  );
}

function FieldBody({ f, tpl, answers, set, p, vi, readOnly }: {
  f: ResolvedField; tpl: ResolvedTemplate; answers: Answers; set: (id: string, v: unknown) => void; p: FormPalette; vi: boolean; readOnly: boolean;
}) {
  const v = answers[f.id];
  const label = <div style={{ fontSize: 15, fontWeight: 600, color: p.ink, lineHeight: 1.35 }}>{f.label}{f.required && f.type !== 'ack' ? <span style={{ color: p.bad }}> *</span> : null}</div>;
  const chip = (on: boolean, warn = false): CSSProperties => ({
    minHeight: 42, padding: '0 14px', borderRadius: 999, fontSize: 14, fontWeight: 700, cursor: readOnly ? 'default' : 'pointer',
    border: `1.5px solid ${on ? (warn ? p.bad : p.accent) : p.line}`,
    background: on ? (warn ? p.bad : p.accent) : p.field,
    color: on ? p.onAccent : p.ink,
  });

  if (f.type === 'yesno') {
    const flagged = (f.flags?.length ?? 0) > 0;
    const note = typeof answers[`${f.id}__note`] === 'string' ? String(answers[`${f.id}__note`]) : '';
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>{label}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={readOnly} onClick={() => set(f.id, true)} style={chip(v === true, flagged)}>{vi ? 'Có' : 'Yes'}</button>
            <button type="button" disabled={readOnly} onClick={() => set(f.id, false)} style={chip(v === false)}>{vi ? 'Không' : 'No'}</button>
          </div>
        </div>
        {v === true && f.detail && (
          <input value={note} readOnly={readOnly} onChange={(e) => set(`${f.id}__note`, e.target.value)} maxLength={500}
            placeholder={vi ? 'Ghi vài chữ (không bắt buộc)' : 'A few words (optional)'}
            style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', minHeight: 42, borderRadius: 10, border: `1px solid ${p.line}`, background: p.field, color: p.ink, padding: '0 12px', fontSize: 15 }} />
        )}
      </div>
    );
  }

  if (f.type === 'choice' || f.type === 'multi') {
    const list = Array.isArray(v) ? (v as string[]) : [];
    const on = (id: string) => (f.type === 'multi' ? list.includes(id) : v === id);
    const tap = (id: string) => {
      if (f.type === 'multi') set(f.id, on(id) ? list.filter((x) => x !== id) : [...list, id]);
      else set(f.id, v === id ? undefined : id);
    };
    return (
      <div>
        {label}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {(f.options ?? []).map((o) => <button key={o.id} type="button" disabled={readOnly} onClick={() => tap(o.id)} style={chip(on(o.id))}>{o.label}</button>)}
        </div>
      </div>
    );
  }

  if (f.type === 'text') {
    const s = typeof v === 'string' ? v : '';
    const style: CSSProperties = { marginTop: 8, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${p.line}`, background: p.field, color: p.ink, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit' };
    return (
      <div>
        {label}
        {f.short
          ? <input value={s} readOnly={readOnly} onChange={(e) => set(f.id, e.target.value)} maxLength={200} style={{ ...style, minHeight: 44 }} />
          : <textarea value={s} readOnly={readOnly} onChange={(e) => set(f.id, e.target.value)} maxLength={500} rows={2} style={{ ...style, resize: 'vertical' }} />}
      </div>
    );
  }

  if (f.type === 'bodymap') {
    const list = Array.isArray(v) ? (v as string[]) : [];
    const avoid = /avoid|tránh/i.test(f.id + f.label);
    const names = list.map((id) => tpl.areas.find((a) => a.id === id)?.label ?? id);
    return (
      <div>
        {label}
        <BodyMap selected={list} onToggle={(id) => set(f.id, list.includes(id) ? list.filter((x) => x !== id) : [...list, id])}
          areas={tpl.areas} p={p} tone={avoid ? p.bad : p.accent} vi={vi} readOnly={readOnly} />
        <div style={{ fontSize: 13, color: list.length ? p.ink : p.sub, marginTop: 6, minHeight: 18 }}>
          {list.length ? names.join(', ') : (vi ? 'Chạm vào vùng trên hình' : 'Tap the areas on the figure')}
        </div>
      </div>
    );
  }

  if (f.type === 'scale') {
    const lo = f.min ?? 0, hi = f.max ?? 10;
    const nums = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    return (
      <div>
        {label}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${nums.length}, minmax(0, 1fr))`, gap: 4, marginTop: 10 }}>
          {nums.map((n) => (
            <button key={n} type="button" disabled={readOnly} onClick={() => set(f.id, v === n ? undefined : n)}
              style={{ ...chip(v === n, n >= 7), minHeight: 40, padding: 0, borderRadius: 8 }}>{n}</button>
          ))}
        </div>
      </div>
    );
  }

  if (f.type === 'ack') {
    const on = v === true;
    return (
      <button type="button" disabled={readOnly} onClick={() => set(f.id, on ? undefined : true)}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: readOnly ? 'default' : 'pointer', color: p.ink }}>
        <span aria-hidden style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, border: `2px solid ${on ? p.accent : p.line}`, background: on ? p.accent : p.field, color: p.onAccent, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 900 }}>{on ? '✓' : ''}</span>
        <span style={{ fontSize: 15, lineHeight: 1.45 }}>{f.label}</span>
      </button>
    );
  }
  return null;
}

// ---------------------------------------------------------------- body map

type Shape = { id: string; kind: 'r' | 'e'; x: number; y: number; w: number; h: number };
const R = (id: string, x: number, y: number, w: number, h: number): Shape => ({ id, kind: 'r', x, y, w, h });
const E = (id: string, cx: number, cy: number, rx: number, ry: number): Shape => ({ id, kind: 'e', x: cx, y: cy, w: rx, h: ry });

// Front: the figure faces you, so its right side is on your left.
const FRONT: Shape[] = [
  E('head', 100, 20, 13, 15), R('neck_front', 92, 35, 16, 8), R('chest', 74, 43, 52, 27), R('abdomen', 77, 70, 46, 26),
  R('hip_front', 75, 96, 50, 16), R('arm_r', 58, 45, 14, 50), R('arm_l', 128, 45, 14, 50), E('hand_r', 65, 104, 7, 9), E('hand_l', 135, 104, 7, 9),
  R('thigh_r', 77, 113, 22, 42), R('thigh_l', 101, 113, 22, 42), E('knee_r', 88, 162, 10, 7), E('knee_l', 112, 162, 10, 7),
  R('shin_r', 80, 170, 17, 32), R('shin_l', 103, 170, 17, 32), E('foot_r', 87, 208, 10, 5), E('foot_l', 113, 208, 10, 5),
];
// Back: you see it from behind, so its left side is on your left.
const BACK: Shape[] = [
  R('neck', 92, 35, 16, 10), R('shoulder_l', 62, 43, 28, 14), R('shoulder_r', 110, 43, 28, 14), R('upper_back', 76, 57, 48, 18),
  R('mid_back', 77, 75, 46, 16), R('lower_back', 78, 91, 44, 14), R('glutes', 75, 105, 50, 18),
  R('hamstring_l', 77, 124, 22, 40), R('hamstring_r', 101, 124, 22, 40), R('calf_l', 79, 168, 19, 36), R('calf_r', 102, 168, 19, 36),
];
const BACK_DECOR: Shape[] = [E('_head', 100, 20, 13, 15), R('_arm_l', 58, 58, 14, 46), R('_arm_r', 128, 58, 14, 46)];

export function BodyMap({ selected, onToggle, areas, p, tone, vi, readOnly }: {
  selected: string[]; onToggle: (id: string) => void; areas: ResolvedTemplate['areas']; p: FormPalette; tone: string; vi: boolean; readOnly?: boolean;
}) {
  const name = (id: string) => areas.find((a) => a.id === id)?.label ?? id;
  const draw = (s: Shape, clickable: boolean) => {
    const on = selected.includes(s.id);
    const common = {
      fill: on ? tone : p.field, stroke: on ? tone : p.sub, strokeWidth: 1.2, opacity: clickable ? 1 : 0.45,
      style: { cursor: clickable && !readOnly ? 'pointer' : 'default' } as CSSProperties,
      onClick: clickable && !readOnly ? () => onToggle(s.id) : undefined,
    };
    const title = clickable ? <title>{name(s.id)}</title> : null;
    return s.kind === 'e'
      ? <ellipse key={s.id} cx={s.x} cy={s.y} rx={s.w} ry={s.h} {...common}>{title}</ellipse>
      : <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} rx={6} {...common}>{title}</rect>;
  };
  const fig = (shapes: Shape[], decor: Shape[], caption: string) => (
    <figure style={{ margin: 0, flex: 1, minWidth: 0, textAlign: 'center' }}>
      <svg viewBox="50 0 100 218" style={{ width: '100%', maxWidth: 170, height: 'auto', touchAction: 'manipulation' }} role="group" aria-label={caption}>
        {decor.map((s) => draw(s, false))}
        {shapes.map((s) => draw(s, true))}
      </svg>
      <figcaption style={{ fontSize: 12, fontWeight: 700, color: p.sub }}>{caption}</figcaption>
    </figure>
  );
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, maxWidth: 380 }}>
      {fig(FRONT, [], vi ? 'Mặt trước' : 'Front')}
      {fig(BACK, BACK_DECOR, vi ? 'Mặt sau' : 'Back')}
    </div>
  );
}
