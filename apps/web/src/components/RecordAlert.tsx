'use client';

/**
 * ⚠ warnings from the customer record (allergies, medical history, dietary
 * needs, sensitivities — whatever the business's industry keeps), shown to
 * the desk where a mistake would happen: while booking, and on arrivals.
 * API: GET /customers/record-alerts?phone=… | ?ids=a,b,c (one salon only).
 */
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface RecordWarning { label: { vi: string; en: string }; value: string }
interface Resp { items: { id: string; warnings: RecordWarning[] }[] }

const text = (ws: RecordWarning[], vi: boolean) => ws.map((w) => `${vi ? w.label.vi : w.label.en}: ${w.value}`).join(' · ');

/** Under the phone field of a booking form. */
export function RecordAlertByPhone({ token, phone, vi }: { token: string | null; phone?: string; vi: boolean }) {
  const [ws, setWs] = useState<RecordWarning[]>([]);
  const digits = (phone ?? '').replace(/\D/g, '');
  useEffect(() => {
    setWs([]);
    if (!token || digits.length < 7) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      apiFetch<Resp>(`/customers/record-alerts?phone=${encodeURIComponent(digits)}`, { token })
        .then((r) => { if (alive) setWs((r?.items ?? []).flatMap((x) => x.warnings)); })
        .catch(() => undefined);
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [token, digits]);
  if (!ws.length) return null;
  return (
    <div role="alert" style={{ marginTop: 6, padding: '6px 9px', borderRadius: 8, border: '1px solid var(--ink-bad)', fontSize: 12, fontWeight: 600, color: 'var(--ink-bad)' }}>
      ⚠ {text(ws, vi)}
    </div>
  );
}

/** Warnings for a set of customer ids (the arrivals board), refetched when the set changes. */
export function useRecordAlerts(token: string | null, ids: (string | null | undefined)[], enabled = true): Map<string, RecordWarning[]> {
  const key = useMemo(() => [...new Set(ids.filter((x): x is string => !!x))].sort().slice(0, 60).join(','), [ids]);
  const [map, setMap] = useState<Map<string, RecordWarning[]>>(new Map());
  useEffect(() => {
    if (!token || !enabled || !key) { setMap(new Map()); return undefined; }
    let alive = true;
    apiFetch<Resp>(`/customers/record-alerts?ids=${encodeURIComponent(key)}`, { token })
      .then((r) => { if (alive) setMap(new Map((r?.items ?? []).map((x) => [x.id, x.warnings]))); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [token, key, enabled]);
  return map;
}

/** A small red "⚠" chip with the warnings in its tooltip and accessible label. */
export function RecordAlertChip({ warnings, vi }: { warnings?: RecordWarning[]; vi: boolean }) {
  if (!warnings?.length) return null;
  const t = text(warnings, vi);
  return (
    <span title={t} aria-label={t} style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 999, padding: '2px 8px', color: 'var(--ink-bad)', border: '1px solid var(--ink-bad)' }}>
      ⚠ {warnings.length === 1 ? (vi ? warnings[0].label.vi : warnings[0].label.en) : (vi ? `${warnings.length} lưu ý` : `${warnings.length} alerts`)}
    </span>
  );
}
