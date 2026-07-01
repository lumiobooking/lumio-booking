'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { BarcodeScanner } from '../../../components/BarcodeScanner';

interface GiftCard {
  id: string; code: string; initialCents: number; balanceCents: number; currency: string;
  status: 'ACTIVE' | 'REDEEMED' | 'VOID';
  purchaserName?: string | null; recipientName?: string | null; recipientContact?: string | null;
  note?: string | null; expiresAt?: string | null; createdAt?: string;
}

export default function GiftCardsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [justIssued, setJustIssued] = useState<GiftCard | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const list = await apiFetch<GiftCard[]>('/gift-cards', { token });
      setCards(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gift cards');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function voidCard(id: string) {
    if (!confirm(t('gc.confirmVoid'))) return;
    try {
      await apiFetch(`/gift-cards/${id}/void`, { method: 'POST', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Void failed');
    }
  }

  const visible = sortNewest(
    cards.filter((c) => matchesQuery(`${c.code} ${c.recipientName ?? ''} ${c.purchaserName ?? ''}`, q)),
    (c) => c.createdAt,
  );
  const pg = usePaged(visible, 25);

  const statusColor = (s: GiftCard['status']) => (s === 'ACTIVE' ? '#22c55e' : s === 'REDEEMED' ? '#94a3b8' : '#ef4444');
  const statusLabel = (s: GiftCard['status']) => (s === 'ACTIVE' ? t('gc.stActive') : s === 'REDEEMED' ? t('gc.stRedeemed') : t('gc.stVoid'));

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t('gc.title')}</h1>
        <button onClick={() => { setShowForm((s) => !s); setJustIssued(null); }} style={ui.primaryBtn}>{showForm ? t('gc.close') : t('gc.sell')}</button>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>{t('gc.intro')}</p>

      {error && <div style={ui.banner}>{error}</div>}

      {justIssued && (
        <div style={{ ...ui.card, border: '1px solid #22c55e', marginBottom: 16 }}>
          <strong style={{ color: '#22c55e' }}>{t('gc.issued')}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <code style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, background: '#0f172a', padding: '8px 14px', borderRadius: 8, color: '#a5f3fc' }}>{justIssued.code}</code>
            <span style={{ fontSize: 16, color: '#e2e8f0' }}>{formatPrice(justIssued.balanceCents, justIssued.currency)}</span>
            <button onClick={() => navigator.clipboard?.writeText(justIssued.code)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 13 }}>{t('gc.copyCode')}</button>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0 0' }}>{t('gc.issuedHint')}</p>
        </div>
      )}

      {showForm && <IssueForm token={token!} onDone={async (card) => { setShowForm(false); setJustIssued(card); await load(); }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, margin: '16px 0' }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('gc.searchPh')} />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('gc.cardsWord')}</span>
      </div>

      {loading ? <p style={{ color: '#94a3b8' }}>{t('gc.loading')}</p> : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={ui.th}>{t('gc.colCode')}</th><th style={ui.th}>{t('gc.colBalance')}</th><th style={ui.th}>{t('gc.colRecipient')}</th><th style={ui.th}>{t('gc.colStatus')}</th><th style={ui.th}>{t('gc.colActions')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={5}>{t('gc.empty')}</td></tr>}
              {pg.paged.map((c) => (
                <Fragment key={c.id}>
                  <tr style={{ borderTop: '1px solid #334155' }}>
                    <td style={{ ...ui.td, fontFamily: 'monospace', fontWeight: 700, color: '#a5f3fc' }}>{c.code}</td>
                    <td style={ui.td}>
                      <span style={{ fontWeight: 700 }}>{formatPrice(c.balanceCents, c.currency)}</span>
                      <span style={{ color: '#64748b', fontSize: 12 }}> / {formatPrice(c.initialCents, c.currency)}</span>
                    </td>
                    <td style={{ ...ui.td, color: '#cbd5e1', fontSize: 13 }}>{c.recipientName || '—'}{c.recipientContact ? <div style={{ color: '#64748b' }}>{c.recipientContact}</div> : null}</td>
                    <td style={ui.td}><span style={{ color: statusColor(c.status), fontWeight: 600 }}>{statusLabel(c.status)}</span></td>
                    <td style={ui.td}>
                      {c.status !== 'VOID' && <button onClick={() => voidCard(c.id)} style={ui.dangerBtn}>{t('gc.void')}</button>}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

function IssueForm({ token, onDone }: { token: string; onDone: (card: GiftCard) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({ amount: '', code: '', recipientName: '', recipientContact: '', purchaserName: '', paymentMethod: 'CASH' as 'CASH' | 'CARD' | 'OTHER', note: '', expiresAt: '' });
  const [scan, setScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountCents = Math.round((parseFloat(form.amount) || 0) * 100);
    if (amountCents <= 0) { setError(t('gc.amountRequired')); return; }
    setSaving(true); setError(null);
    try {
      const card = await apiFetch<GiftCard>('/gift-cards', {
        method: 'POST', token,
        body: {
          amountCents,
          code: form.code.trim() || undefined,
          paymentMethod: form.paymentMethod,
          recipientName: form.recipientName || undefined,
          recipientContact: form.recipientContact || undefined,
          purchaserName: form.purchaserName || undefined,
          note: form.note || undefined,
          expiresAt: form.expiresAt || undefined,
        },
      });
      onDone(card);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue gift card');
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ ...ui.card, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{t('gc.amount')} <span style={{ color: '#ef4444' }}>*</span></span>
          <input style={ui.input} type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('gc.payMethod')}</span>
          <select style={ui.input} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as 'CASH' | 'CARD' | 'OTHER' })}>
            <option value="CASH">{t('gc.mCash')}</option>
            <option value="CARD">{t('gc.mCard')}</option>
            <option value="OTHER">{t('gc.mOther')}</option>
          </select></label>
      </div>

      <div>
        <span style={ui.label}>{t('gc.code')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...ui.input, flex: 1 }} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t('gc.codePh')} />
          <button type="button" onClick={() => setScan(true)} style={{ ...ui.input, width: 'auto', padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📷 {t('gc.scan')}</button>
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0' }}>{t('gc.codeHint')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{t('gc.recipientName')}</span>
          <input style={ui.input} value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} /></label>
        <label><span style={ui.label}>{t('gc.recipientContact')}</span>
          <input style={ui.input} value={form.recipientContact} onChange={(e) => setForm({ ...form, recipientContact: e.target.value })} /></label>
        <label><span style={ui.label}>{t('gc.expiry')}</span>
          <input lang="en-US" style={ui.input} type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? t('gc.issuing') : t('gc.issueBtn')}</button>

      {scan && (
        <BarcodeScanner
          title={t('gc.scanTitle')}
          hint={t('gc.scanHint')}
          errorText={t('gc.scanError')}
          onDetect={(code) => { setScan(false); setForm((f) => ({ ...f, code })); }}
          onClose={() => setScan(false)}
        />
      )}
    </form>
  );
}
