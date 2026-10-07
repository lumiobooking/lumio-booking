'use client';

/**
 * BẢNG KHÁCH TIỀM NĂNG — a real-estate office's leads as a board, one column
 * per stage (the same stages as the customer record, api common/industry-fields).
 * Drag a card to another column — or, on a phone, use the ‹ › buttons — and the
 * lead's stage is saved (PATCH /customers/:id { industryFields: { stage } }).
 */
import { useState } from 'react';

export interface BoardLead { id: string; firstName: string; lastName: string | null; phone: string | null; industryFields?: Record<string, string | number> }
export interface Stage { v: string; vi: string; en: string }

export function LeadBoard({ leads, stages, vi, onMove }: { leads: BoardLead[]; stages: Stage[]; vi: boolean; onMove: (id: string, stage: string) => Promise<void> }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cols: Stage[] = [{ v: '', vi: 'Chưa phân loại', en: 'No stage' }, ...stages];
  const stageOf = (l: BoardLead) => String(l.industryFields?.stage ?? '');

  async function move(id: string, stage: string) {
    const l = leads.find((x) => x.id === id);
    if (!l || stageOf(l) === stage || !stage) return;
    setBusy(id);
    try { await onMove(id, stage); } finally { setBusy(null); }
  }

  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {cols.map((c, ci) => {
        const items = leads.filter((l) => stageOf(l) === c.v);
        const won = c.v === 'won'; const lost = c.v === 'lost';
        return (
          <div key={c.v || 'none'}
            onDragOver={(e) => { if (drag && c.v) { e.preventDefault(); setOver(c.v); } }}
            onDragLeave={() => setOver((o) => (o === c.v ? null : o))}
            onDrop={(e) => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (id) void move(id, c.v); }}
            style={{ flex: '0 0 230px', minHeight: 120, borderRadius: 12, padding: 8, border: `1px solid ${over === c.v ? 'var(--c818cf8)' : 'var(--c334155)'}`, background: over === c.v ? 'var(--c1e293b)' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 8px', fontSize: 13, fontWeight: 700, color: won ? 'var(--ink-good)' : lost ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>
              <span style={{ flex: 1 }}>{vi ? c.vi : c.en}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {items.slice(0, 200).map((l) => {
                const f = l.industryFields ?? {};
                const sub = [f.area, f.budget, f.propertyType].filter(Boolean).join(' · ');
                const prev = cols[ci - 1]; const next = cols[ci + 1];
                return (
                  <div key={l.id} draggable onDragStart={() => setDrag(l.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    style={{ padding: '8px 9px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', cursor: 'grab', opacity: busy === l.id || drag === l.id ? 0.5 : 1 }}>
                    <a href={`/salon/customers/${l.id}`} style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--c818cf8)', textDecoration: 'none' }}>{l.firstName} {l.lastName ?? ''}</a>
                    {sub && <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{String(sub)}</div>}
                    {f.nextStep && <div style={{ fontSize: 11.5, color: 'var(--ink-warn)', marginTop: 2 }}>📞 {String(f.nextStep)}</div>}
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      {prev && prev.v && <button type="button" aria-label={vi ? `Chuyển về ${prev.vi}` : `Move to ${prev.en}`} disabled={busy === l.id} onClick={() => move(l.id, prev.v)} style={mini}>‹</button>}
                      {l.phone && <a href={`tel:${l.phone}`} style={{ ...mini, textDecoration: 'none', flex: 1, textAlign: 'center' }}>{l.phone}</a>}
                      {next && <button type="button" aria-label={vi ? `Chuyển sang ${next.vi}` : `Move to ${next.en}`} disabled={busy === l.id} onClick={() => move(l.id, next.v)} style={mini}>›</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const mini: React.CSSProperties = { padding: '3px 8px', borderRadius: 6, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12, cursor: 'pointer' };
