'use client';

/**
 * HỒ SƠ THEO NGÀNH — the record this line of business keeps on a customer.
 *
 * A clinic's patient record (allergies, history, X-ray, treatment plan,
 * recall), a real-estate lead (stage, need, budget, area, next follow-up), a
 * restaurant guest (dietary, seating, occasion), a lash map, a colour
 * formula… The fields come from the server (customers/industry-fields) so
 * the form always matches the salon's own industry; the server checks every
 * key and value again on save. Allergies and health notes show as a red
 * banner at the top so nobody misses them.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

type FieldType = 'text' | 'longtext' | 'select' | 'date' | 'number';
interface FieldDef { key: string; type: FieldType; vi: string; en: string; options?: { value: string; vi: string; en: string }[]; warn?: boolean }
interface Defs { industry: string; title: { vi: string; en: string }; fields: FieldDef[] }

export function IndustryRecordCard({ token, customerId, values, vi, onSaved }: {
  token: string | null; customerId: string; values: Record<string, string | number> | undefined; vi: boolean; onSaved?: () => void;
}) {
  const [defs, setDefs] = useState<Defs | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<Defs>('/customers/industry-fields', { token }).then(setDefs).catch(() => setDefs(null));
  }, [token]);
  useEffect(() => {
    const v = values ?? {};
    setForm(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? '')])));
  }, [values]);

  if (!defs) return null;
  const warns = defs.fields.filter((f) => f.warn && (values?.[f.key] ?? '') !== '' && String(values?.[f.key]).trim());
  const dirty = defs.fields.some((f) => (form[f.key] ?? '') !== String(values?.[f.key] ?? ''));

  async function save() {
    if (!token || !defs) return;
    setBusy(true); setMsg(null);
    try {
      const body = Object.fromEntries(defs.fields.map((f) => [f.key, form[f.key] ?? '']));
      await apiFetch(`/customers/${customerId}`, { method: 'PATCH', token, body: { industryFields: body } });
      setMsg(vi ? '✓ Đã lưu' : '✓ Saved');
      onSaved?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 18 }}>
      {warns.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
          {warns.map((f) => (
            <div key={f.key} style={{ fontSize: 13, color: 'var(--ink-bad)', fontWeight: 600 }}>⚠ {vi ? f.vi : f.en}: {String(values?.[f.key])}</div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', marginBottom: 10 }}>🗂️ {vi ? defs.title.vi : defs.title.en}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {defs.fields.map((f) => (
          <label key={f.key} style={{ gridColumn: f.type === 'longtext' ? '1 / -1' : undefined }}>
            <span style={ui.label}>{f.warn ? '⚠ ' : ''}{vi ? f.vi : f.en}</span>
            {f.type === 'select' ? (
              <select style={ui.input} value={form[f.key] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{vi ? o.vi : o.en}</option>)}
              </select>
            ) : f.type === 'longtext' ? (
              <textarea rows={3} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} value={form[f.key] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value.slice(0, 2000) }))} />
            ) : (
              <input style={ui.input} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined}
                value={form[f.key] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value.slice(0, 300) }))} />
            )}
            {f.key === 'recallMonths' && (
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c64748b)', marginTop: 4 }}>
                {vi ? 'Tự gửi nhắc tái khám khi đến hạn — bật "Nhắc quay lại" ở Cài đặt → Nhắc lịch.' : 'A check-up reminder is sent when due — turn on "Rebooking reminder" in Settings → Reminders.'}
              </span>
            )}
            {f.key === 'nextStep' && (
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c64748b)', marginTop: 4 }}>
                {vi ? 'Đến ngày này, khách hiện ở mục "Cần gọi lại" và cả nhóm nhận thông báo buổi sáng.' : 'On this day the lead shows under "Call-backs due" and the team gets a morning push.'}
              </span>
            )}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...ui.primaryBtn, opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? '…' : (vi ? 'Lưu hồ sơ' : 'Save record')}</button>
        {msg && <span style={{ fontSize: 12.5, color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg}</span>}
      </div>
    </div>
  );
}
