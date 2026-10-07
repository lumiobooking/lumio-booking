'use client';

// MỤC TIÊU RIÊNG on the technician's "Tôi" screen.
//
// Her own week and month targets — service sales, number of clients — with
// a bar for each. She sets them herself in a sheet; nobody else sees them
// (GET / PUT /my-pay/goals read and write her key alone). A goal reached
// turns green; a quiet "còn X" line says what is left.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { formatPrice, fromMinorUnits, priceInputStep, toMinorUnits } from '../../lib/ui';
import { L, Sheet, st } from './kit';

interface Goal { weekCents: number | null; monthCents: number | null; weekVisits: number | null; monthVisits: number | null }
interface Progress { key: keyof Goal; target: number; actual: number; pct: number; left: number; done: boolean }
interface Data { today: string; currency: string; goal: Goal; week: { from: string; to: string; serviceCents: number; visits: number }; month: { from: string; to: string; serviceCents: number; visits: number }; progress: Progress[] }

export function GoalsCard({ token, vi }: { token: string | null; vi: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ weekCents: '', monthCents: '', weekVisits: '', monthVisits: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch<Data>('/my-pay/goals', { token }).catch(() => null);
    setData(r);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return null;
  const cur = data.currency;
  const money = (c: number) => formatPrice(c, cur);
  const label = (k: keyof Goal) => ({
    weekCents: L(vi, 'Doanh thu tuần này', 'Sales this week'), monthCents: L(vi, 'Doanh thu tháng này', 'Sales this month'),
    weekVisits: L(vi, 'Khách tuần này', 'Clients this week'), monthVisits: L(vi, 'Khách tháng này', 'Clients this month'),
  })[k];
  const fmt = (k: keyof Goal, n: number) => (k.endsWith('Cents') ? money(n) : String(n));

  function edit() {
    const g = data!.goal;
    setF({
      weekCents: g.weekCents ? fromMinorUnits(g.weekCents, cur) : '', monthCents: g.monthCents ? fromMinorUnits(g.monthCents, cur) : '',
      weekVisits: g.weekVisits ? String(g.weekVisits) : '', monthVisits: g.monthVisits ? String(g.monthVisits) : '',
    });
    setErr(null); setOpen(true);
  }
  async function save() {
    setBusy(true); setErr(null);
    try {
      await apiFetch('/my-pay/goals', { method: 'PATCH', token, body: {
        weekCents: f.weekCents.trim() ? toMinorUnits(f.weekCents, cur) : null, monthCents: f.monthCents.trim() ? toMinorUnits(f.monthCents, cur) : null,
        weekVisits: f.weekVisits.trim() ? Number(f.weekVisits) : null, monthVisits: f.monthVisits.trim() ? Number(f.monthVisits) : null,
      } });
      setOpen(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const field = (k: keyof typeof f, text: string, isMoney: boolean) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={st.label}>{text}</span>
      <input type="number" inputMode="decimal" min={0} step={isMoney ? priceInputStep(cur) : 1} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={L(vi, 'Không đặt', 'None')}
        style={{ height: 46, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 16, padding: '0 12px', width: '100%', boxSizing: 'border-box' }} />
    </label>
  );

  return (
    <div style={{ ...st.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', flex: 1 }}>{L(vi, 'Mục tiêu của tôi', 'My goals')}</div>
        <button type="button" onClick={edit} style={{ ...st.ghost, height: 36, padding: '0 12px', fontSize: 13 }}>{data.progress.length ? L(vi, 'Sửa', 'Edit') : L(vi, 'Đặt mục tiêu', 'Set goals')}</button>
      </div>
      {data.progress.length === 0 ? (
        <div style={{ fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
          {L(vi, 'Đặt mục tiêu doanh thu hoặc số khách cho tuần / tháng. Chỉ mình bạn thấy.', 'Set a sales or client target for the week / month. Only you can see it.')}
        </div>
      ) : data.progress.map((p) => (
        <div key={p.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: 'var(--ccbd5e1)' }}>
            <span>{label(p.key)}</span>
            <span style={{ fontWeight: 700, color: p.done ? 'var(--ink-good)' : 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.key, p.actual)} / {fmt(p.key, p.target)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--c1e293b)', marginTop: 5, overflow: 'hidden' }}>
            <div style={{ width: `${p.pct}%`, height: '100%', borderRadius: 999, background: p.done ? '#15803d' : '#6366f1', transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 12, color: p.done ? 'var(--ink-good)' : 'var(--c94a3b8)', marginTop: 3 }}>
            {p.done ? L(vi, '✓ Đạt rồi!', '✓ Reached!') : L(vi, `Còn ${fmt(p.key, p.left)} · ${p.pct}%`, `${fmt(p.key, p.left)} to go · ${p.pct}%`)}
          </div>
        </div>
      ))}

      <Sheet open={open} onClose={() => setOpen(false)} label={L(vi, 'Mục tiêu', 'Goals')}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Mục tiêu của tôi', 'My goals')}</div>
        <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4 }}>{L(vi, 'Tính theo tiền dịch vụ của bạn (chưa gồm tip). Để trống nếu không đặt.', 'Counted on your service sales (tips not included). Leave empty for none.')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          {field('weekCents', L(vi, `Doanh thu / tuần (${cur})`, `Sales / week (${cur})`), true)}
          {field('weekVisits', L(vi, 'Khách / tuần', 'Clients / week'), false)}
          {field('monthCents', L(vi, `Doanh thu / tháng (${cur})`, `Sales / month (${cur})`), true)}
          {field('monthVisits', L(vi, 'Khách / tháng', 'Clients / month'), false)}
        </div>
        {err && <div style={{ color: 'var(--ink-bad)', fontSize: 14, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={() => setOpen(false)} style={{ ...st.ghost, flex: 1, height: 52 }}>{L(vi, 'Huỷ', 'Cancel')}</button>
          <button type="button" disabled={busy} onClick={save} style={{ ...st.primary, flex: 2 }}>{busy ? '…' : L(vi, 'Lưu', 'Save')}</button>
        </div>
      </Sheet>
    </div>
  );
}
