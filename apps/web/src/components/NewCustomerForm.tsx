'use client';

// "Thêm khách" by hand — the one client the owner wants in the system right
// now, without a CSV: name, phone (the salon's natural key), email, birthday,
// a note; and, for the owner, what this client spent and how often they came
// in the old system plus their old points, so remarketing and loyalty start
// from the real history. Uses the same endpoints the import and the customer
// page use (POST /customers, PATCH /customers/:id, POST /customers/:id/points).

import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { ui, toMinorUnits, priceInputStep } from '../lib/ui';
import { uiCurrency } from '../lib/ui-currency';
import { ind } from '../lib/ui-industry';

export function NewCustomerForm({ vi, isOwner, onClose, onCreated }: { vi: boolean; isOwner: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const cur = uiCurrency();
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', birthDate: '', notes: '', spent: '', visits: '', lastVisit: '', points: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const canSave = f.firstName.trim().length > 0 && (f.phone.replace(/\D/g, '').length >= 7 || /\S+@\S+\.\S+/.test(f.email.trim()));

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    try {
      const c = await apiFetch<{ id: string }>('/customers', { method: 'POST', token, body: {
        firstName: f.firstName.trim(), lastName: f.lastName.trim() || undefined,
        phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, birthDate: f.birthDate || undefined,
      } });
      const spent = f.spent.trim() ? Math.max(0, toMinorUnits(f.spent, cur) || 0) : 0;
      const visits = Math.max(0, parseInt(f.visits, 10) || 0);
      const patch: Record<string, unknown> = {};
      if (f.notes.trim()) patch.notes = f.notes.trim().slice(0, 2000);
      if (isOwner && (spent > 0 || visits > 0 || f.lastVisit)) { patch.pastSpentCents = spent; patch.pastVisits = visits; patch.lastVisitAt = f.lastVisit || null; }
      if (Object.keys(patch).length) await apiFetch(`/customers/${c.id}`, { method: 'PATCH', token, body: patch });
      const pts = Math.max(0, parseInt(f.points, 10) || 0);
      if (isOwner && pts > 0) await apiFetch(`/customers/${c.id}/points`, { method: 'POST', token, body: { points: pts, reason: L('Điểm từ hệ thống cũ', 'Points from the old system') } });
      onCreated(c.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={ui.label}>{label}</span>{input}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{hint}</span>}
    </label>
  );

  return (
    <div style={{ ...ui.card, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Thêm khách', 'Add a client')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{L('Cần tên và số điện thoại (hoặc email). Trùng số điện thoại thì hệ thống dùng lại hồ sơ cũ, không tạo thêm.', 'Name plus a phone (or email). A known phone number reuses the existing record instead of making a twin.')}</div>
        </div>
        <button type="button" onClick={onClose} style={{ ...ui.input, width: 'auto', cursor: 'pointer', marginLeft: 'auto', padding: '6px 12px' }}>{L('Đóng', 'Close')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {field(L('Tên *', 'First name *'), <input value={f.firstName} onChange={set('firstName')} maxLength={80} style={ui.input} autoFocus />)}
        {field(L('Họ', 'Last name'), <input value={f.lastName} onChange={set('lastName')} maxLength={80} style={ui.input} />)}
        {field(L('Số điện thoại *', 'Phone *'), <input value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={40} style={ui.input} placeholder="+1 512 555 0123" />)}
        {field(L('Email', 'Email'), <input value={f.email} onChange={set('email')} type="email" style={ui.input} />)}
        {field(L('Sinh nhật', 'Birthday'), <input value={f.birthDate} onChange={set('birthDate')} type="date" lang="en-US" style={ui.input} />, L('Để gửi lời chúc / ưu đãi sinh nhật.', 'For birthday greetings and offers.'))}
      </div>
      {field(L('Ghi chú', 'Notes'), <textarea value={f.notes} onChange={set('notes')} maxLength={2000} rows={2} style={{ ...ui.input, resize: 'vertical' }} placeholder={L('VD: thích màu đỏ, dị ứng acrylic…', 'e.g. likes red, allergic to acrylic…')} />)}

      {isOwner && (
        <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L('Lịch sử ở hệ thống cũ (không bắt buộc)', 'History from the old system (optional)')}</div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', margin: '2px 0 10px' }}>{L('Để xem đúng tổng chi tiêu, số lần đến, chạy remarketing và giữ điểm tích luỹ cũ.', 'So lifetime spend, visits, win-back campaigns and loyalty points start from the real history.')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {field(L(`Tổng chi tiêu (${cur})`, `Total spent (${cur})`), <input value={f.spent} onChange={set('spent')} type="number" min={0} step={priceInputStep(cur)} style={ui.input} />)}
            {field(L('Số lần đến', 'Visits'), <input value={f.visits} onChange={set('visits')} type="number" min={0} step={1} style={ui.input} />)}
            {field(L('Lần đến gần nhất', 'Last visit'), <input value={f.lastVisit} onChange={set('lastVisit')} type="date" lang="en-US" style={ui.input} />)}
            {field(L('Điểm tích luỹ cũ', 'Old loyalty points'), <input value={f.points} onChange={set('points')} type="number" min={0} step={1} style={ui.input} />)}
          </div>
        </div>
      )}

      {err && <div style={ui.banner}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={save} disabled={busy || !canSave} style={{ ...ui.primaryBtn, opacity: canSave ? 1 : 0.5 }}>{busy ? L('Đang lưu…', 'Saving…') : L('Lưu khách', 'Save client')}</button>
        {!canSave && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Nhập tên và số điện thoại hoặc email.', 'Enter a name and a phone or email.')}</span>}
      </div>
    </div>
  );
}
