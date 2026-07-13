'use client';

// Bulk email marketing — one composer, two homes:
//   Super Admin  → base '/admin/email-campaigns'  (Lumio pitching salons)
//   Salon Admin  → base '/email-campaigns'        (a salon emailing its customers)
//
// The salon never touches HTML. They fill in blocks and watch a live preview of the
// exact email that will land in the inbox. Every send is logged, and every message
// carries a one-click unsubscribe.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { Preset } from '../lib/emailPresets';

export interface Campaign {
  id: string; name: string; subject: string; status: string;
  total: number; sent: number; failed: number; skipped: number;
  sentAt: string | null; createdAt: string;
}
interface Recipient { id: string; email: string; status: string; error: string | null; sentAt: string | null }
interface Contact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  replied: boolean;
  repliedAt: string | null;
  sends: number;
  lastStep: number;
  lastSentAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastCampaign: string;
  unsubscribed: boolean;
}
type ContactFilter = 'all' | 'new' | 'ok' | 'failed' | 'replied' | 'unsub';
type PickTarget = 'all' | 'new' | 'silent' | 'failed';
type Tab = 'compose' | 'contacts' | 'auto' | 'outbox';

interface Automation {
  enabled: boolean; name: string; everyDays: number; dailyCap: number;
  fromName: string; replyTo: string; steps: Partial<Draft>[];
  lastRunAt: string | null; sentTotal: number; dueNow: number;
}
interface CampaignDetail extends Campaign { html: string | null; recipients: Recipient[] }

interface Draft {
  name: string; subject: string; fromName: string; replyTo: string; preheader: string;
  heading: string; body: string; imageUrl: string; ctaLabel: string; ctaUrl: string;
  footerNote: string; recipients: string;
}
const EMPTY: Draft = {
  name: '', subject: '', fromName: '', replyTo: '', preheader: '',
  heading: '', body: '', imageUrl: '', ctaLabel: '', ctaUrl: '', footerNote: '', recipients: '',
};

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
function parseList(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = []; const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL_RE.test(p)) { invalid.push(p); continue; }
    if (seen.has(p)) continue;
    seen.add(p); valid.push(p);
  }
  return { valid, invalid };
}

const STATUS: Record<string, { label: string; c: string }> = {
  draft:   { label: 'Draft',   c: '#94a3b8' },
  sending: { label: 'Sending', c: '#f59e0b' },
  sent:    { label: 'Sent',    c: '#22c55e' },
  failed:  { label: 'Failed',  c: '#ef4444' },
};

export function EmailCampaigns({ base, vi, defaultFromName, presets = [] }: { base: string; vi: boolean; defaultFromName?: string; presets?: Preset[] }) {
  const { token } = useAuth();
  const [d, setD] = useState<Draft>({ ...EMPTY, fromName: defaultFromName ?? '' });
  const [list, setList] = useState<Campaign[]>([]);
  const [open, setOpen] = useState<CampaignDetail | null>(null);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [pickOpen, setPickOpen] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // The address book
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cFilter, setCFilter] = useState<ContactFilter>('all');
  const [cQuery, setCQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const composeRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>('compose');
  const [importText, setImportText] = useState('');
  const [repliedText, setRepliedText] = useState('');
  const [auto, setAuto] = useState<Automation | null>(null);

  const t = (v: string, e: string) => (vi ? v : e);

  const loadList = useCallback(async () => {
    if (!token) return;
    try { setList(await apiFetch<Campaign[]>(base, { token })); } catch { /* ignore */ }
    try { setContacts(await apiFetch<Contact[]>(`${base}/contacts`, { token })); } catch { /* ignore */ }
    try { setAuto(await apiFetch<Automation>(`${base}/automation`, { token })); } catch { /* ignore */ }
  }, [token, base]);
  useEffect(() => { loadList(); }, [loadList]);

  // Keep polling while something is in flight, so the counters move on screen.
  useEffect(() => {
    if (!list.some((c) => c.status === 'sending')) return;
    const id = window.setInterval(loadList, 3000);
    return () => window.clearInterval(id);
  }, [list, loadList]);

  // Live preview — debounced, rendered by the SAME code that sends the email.
  useEffect(() => {
    if (!token) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await apiFetch<{ html: string }>(`${base}/preview`, {
          method: 'POST', token,
          body: {
            subject: d.subject, preheader: d.preheader, heading: d.heading, body: d.body,
            imageUrl: d.imageUrl, ctaLabel: d.ctaLabel, ctaUrl: d.ctaUrl, footerNote: d.footerNote,
          },
        });
        setHtml(r.html);
      } catch { /* preview is best-effort */ }
    }, 400);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [token, base, d.subject, d.preheader, d.heading, d.body, d.imageUrl, d.ctaLabel, d.ctaUrl, d.footerNote]);

  const parsed = useMemo(() => parseList(d.recipients), [d.recipients]);
  const canSend = !!d.subject.trim() && !!d.fromName.trim() && parsed.valid.length > 0;

  const payload = () => ({
    name: d.name || d.subject, subject: d.subject, fromName: d.fromName, replyTo: d.replyTo || undefined,
    preheader: d.preheader || undefined, heading: d.heading || undefined, body: d.body || undefined,
    imageUrl: d.imageUrl || undefined, ctaLabel: d.ctaLabel || undefined, ctaUrl: d.ctaUrl || undefined,
    footerNote: d.footerNote || undefined, recipients: d.recipients,
  });

  async function sendTest() {
    setError(null); setOk(null); setBusy(true);
    try {
      await apiFetch(`${base}/test`, { method: 'POST', token, body: { ...payload(), to: testTo } });
      setOk(t(`Đã gửi thử tới ${testTo}. Mở hộp thư kiểm tra trước khi gửi hàng loạt.`, `Test sent to ${testTo}. Check it before you send for real.`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }

  async function sendAll() {
    setError(null); setOk(null); setBusy(true); setConfirm(false);
    try {
      const r = await apiFetch<{ queued: number; skipped: number; invalid: number }>(`${base}/send`, {
        method: 'POST', token, body: payload(),
      });
      setOk(t(
        `Đang gửi tới ${r.queued} người. ${r.skipped} người đã huỷ nhận, ${r.invalid} địa chỉ sai — đều bị bỏ qua.`,
        `Sending to ${r.queued} people. ${r.skipped} unsubscribed and ${r.invalid} invalid addresses were skipped.`,
      ));
      setD({ ...EMPTY, fromName: d.fromName });
      await loadList();
    } catch (e) { setError(e instanceof Error ? e.message : 'Send failed'); }
    finally { setBusy(false); }
  }

  // ---- address book: filters, selection, and "send to these again" ---------
  const stats = useMemo(() => ({
    all: contacts.length,
    fresh: contacts.filter((c) => c.sends === 0 && !c.unsubscribed && !c.replied).length,
    ok: contacts.filter((c) => c.sends > 0 && c.lastStatus === 'sent' && !c.unsubscribed && !c.replied).length,
    failed: contacts.filter((c) => c.lastStatus === 'failed' && !c.unsubscribed).length,
    replied: contacts.filter((c) => c.replied).length,
    unsub: contacts.filter((c) => c.unsubscribed).length,
  }), [contacts]);

  const visibleContacts = useMemo(() => {
    const q = cQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      if (q && !(c.email.includes(q) || (c.name ?? '').toLowerCase().includes(q))) return false;
      if (cFilter === 'new') return c.sends === 0 && !c.unsubscribed && !c.replied;
      if (cFilter === 'ok') return c.sends > 0 && c.lastStatus === 'sent' && !c.unsubscribed && !c.replied;
      if (cFilter === 'failed') return c.lastStatus === 'failed' && !c.unsubscribed;
      if (cFilter === 'replied') return c.replied;
      if (cFilter === 'unsub') return c.unsubscribed;
      return true;
    });
  }, [contacts, cFilter, cQuery]);

  // ---- contacts: import, mark as replied, delete ---------------------------
  async function importList() {
    setError(null); setOk(null); setBusy(true);
    try {
      const r = await apiFetch<{ added: number; updated: number; invalid: number }>(`${base}/contacts/import`, {
        method: 'POST', token, body: { list: importText },
      });
      setImportText('');
      await loadList();
      setOk(t(`Đã thêm ${r.added} người mới, cập nhật ${r.updated} người cũ. ${r.invalid} dòng sai định dạng bị bỏ qua.`,
              `${r.added} new, ${r.updated} updated. ${r.invalid} bad lines skipped.`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  /** Paste the addresses of everyone who got back to you — by email, or by phone. */
  async function markRepliedBulk() {
    setError(null); setOk(null); setBusy(true);
    try {
      const r = await apiFetch<{ marked: number }>(`${base}/contacts/replied`, {
        method: 'POST', token, body: { list: repliedText },
      });
      setRepliedText('');
      await loadList();
      setOk(t(`Đã đánh dấu ${r.marked} người đã phản hồi. Hệ thống sẽ không gửi nhắc tự động cho họ nữa.`,
              `${r.marked} marked as replied. The follow-up will never chase them again.`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  async function markReplied(c: Contact, replied: boolean) {
    setError(null);
    try {
      setContacts(await apiFetch<Contact[]>(`${base}/contacts/${c.id}`, { method: 'PATCH', token, body: { replied } }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }
  async function renameContact(c: Contact, name: string) {
    try {
      setContacts(await apiFetch<Contact[]>(`${base}/contacts/${c.id}`, { method: 'PATCH', token, body: { name } }));
    } catch { /* ignore */ }
  }

  // ---- the follow-up -------------------------------------------------------
  async function saveAuto(patch: Partial<Automation>) {
    if (!auto) return;
    setError(null); setOk(null); setBusy(true);
    try {
      const next = { ...auto, ...patch };
      setAuto(await apiFetch<Automation>(`${base}/automation`, {
        method: 'POST', token,
        body: {
          enabled: next.enabled, name: next.name, everyDays: next.everyDays, dailyCap: next.dailyCap,
          fromName: next.fromName || defaultFromName || '', replyTo: next.replyTo || undefined,
          steps: next.steps,
        },
      }));
      setOk(t('Đã lưu.', 'Saved.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  async function runAutoNow() {
    setError(null); setOk(null); setBusy(true);
    try {
      const r = await apiFetch<{ sent: number; failed: number; due: number }>(`${base}/automation/run`, { method: 'POST', token });
      await loadList();
      setOk(t(`Đã chạy: gửi ${r.sent}, lỗi ${r.failed}, tới hạn ${r.due}.`, `Ran: ${r.sent} sent, ${r.failed} failed, ${r.due} due.`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Run failed'); }
    finally { setBusy(false); }
  }
  /** Turn the letter currently in the composer into a step of the follow-up. */
  const addStepFromDraft = () => {
    if (!auto) return;
    if (!d.subject.trim()) { setError(t('Điền tiêu đề trước đã.', 'Give the letter a subject first.')); return; }
    saveAuto({ steps: [...auto.steps, { ...d, recipients: '' }].slice(0, 5) });
    setTab('auto');
  };

  // An unsubscribed address can never be picked — not by "select all", not by hand.
  const pickable = visibleContacts.filter((c) => !c.unsubscribed);
  const allPicked = pickable.length > 0 && pickable.every((c) => picked.has(c.email));
  const toggleAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allPicked) pickable.forEach((c) => next.delete(c.email));
      else pickable.forEach((c) => next.add(c.email));
      return next;
    });
  };
  const togglePick = (email: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  /** Load a whole group out of the address book, names included. Nobody who
   *  unsubscribed or already replied is ever in these lists. */
  const pickTargets = (k: PickTarget): Contact[] => contacts.filter((c) => {
    if (c.unsubscribed || c.replied) return false;      // never chase these two
    if (k === 'new') return c.sends === 0;
    if (k === 'silent') return c.sends > 0 && c.lastStatus !== 'failed';
    if (k === 'failed') return c.lastStatus === 'failed';
    return true;
  });
  const asLines = (rows: Contact[]) => rows.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)).join('\n');
  const fillFromContacts = (k: PickTarget) => {
    const rows = pickTargets(k);
    setD((prev) => ({ ...prev, recipients: asLines(rows) }));
    setOk(t(`Đã đưa ${rows.length} người vào ô người nhận. Chọn mẫu, xem trước, gửi thử, rồi gửi thật.`,
            `${rows.length} people loaded. Pick a template, preview, send yourself a test, then send.`));
  };

  /** Drop the picked addresses into the composer. The template is deliberately NOT
   *  reused: someone who ignored Form 1 should get Form 2, not Form 1 again. */
  const reuse = () => {
    const lines = contacts
      .filter((c) => picked.has(c.email))
      .map((c) => (c.name ? `${c.name} <${c.email}>` : c.email));
    setD({ ...d, recipients: lines.join('\n') });
    setTab('compose');
    setPicked(new Set());
    setPickOpen(true);
    setChosen(null);
    setOk(t('Đã đưa danh sách vào ô soạn thảo. Chọn MỘT MẪU KHÁC (đừng gửi lại đúng mẫu cũ), hoặc tự viết, rồi gửi.',
            'Addresses loaded into the composer. Pick a DIFFERENT template (don’t resend the same one), or write your own, then send.'));
    composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const field = (label: string, hint: string | null, node: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <label style={ui.label}>{label}</label>
      {node}
      {hint && <p style={{ color: '#64748b', fontSize: 11.5, margin: '5px 0 0', lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );

  return (
    <div>
      {error && <div style={ui.banner}>{error}</div>}
      {ok && <div style={{ ...ui.card, marginBottom: 14, borderColor: '#16a34a', color: '#86efac', fontSize: 13.5 }}>{ok}</div>}

      {/* Four jobs, four screens. Trying to do all of it on one page is what made the
          old layout unreadable. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {([
          ['compose', t('✍️ Soạn & gửi', '✍️ Compose'), ''],
          ['contacts', t('👥 Danh bạ', '👥 Contacts'), String(stats.all)],
          ['auto', t('🔁 Tự động', '🔁 Follow-up'), auto?.enabled ? t('BẬT', 'ON') : t('tắt', 'off')],
          ['outbox', t('📤 Hộp thư đi', '📤 Outbox'), String(list.length)],
        ] as [Tab, string, string][]).map(([k, label, badge]) => {
          const on = tab === k;
          const hot = k === 'auto' && auto?.enabled;
          return (
            <button key={k} onClick={() => setTab(k)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                fontSize: 13.5, fontWeight: 700,
                border: on ? '1px solid #6366f1' : '1px solid #334155',
                background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#cbd5e1' }}>
              {label}
              {badge && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 999,
                  background: on ? 'rgba(255,255,255,0.22)' : hot ? '#16a34a' : '#1e293b',
                  color: on ? '#fff' : hot ? '#fff' : '#94a3b8' }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'compose' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* ---------------- compose ---------------- */}
        <div ref={composeRef} style={{ ...ui.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 14 }}>
            {t('Soạn email', 'Compose')}
          </div>

          {/* Pick the template by what you're TRYING TO DO, not by what it's called.
              The wrong template on the wrong list is how a campaign lands in spam. */}
          {presets.length > 0 && (
            <div style={{ marginBottom: 18, border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setPickOpen((v) => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  background: 'rgba(99,102,241,0.10)', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>📨</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
                    {t('Chọn mẫu theo nhu cầu', 'Pick a template by what you need')}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {chosen
                      ? t(`Đang dùng: ${chosen}`, `Using: ${chosen}`)
                      : t(`${presets.length} mẫu — bấm một cái là điền hết, sửa lại thoải mái`, `${presets.length} templates — one click fills everything, then edit`)}
                  </span>
                </span>
                <span style={{ color: '#94a3b8', fontSize: 12, transform: pickOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>▶</span>
              </button>

              {pickOpen && (
                <div style={{ padding: 10, display: 'grid', gap: 8 }}>
                  {presets.map((p) => {
                    const on = chosen === p.label;
                    return (
                      <button key={p.label}
                        onClick={() => {
                          setD({ ...EMPTY, ...p.draft, fromName: p.draft.fromName || d.fromName || defaultFromName || '' });
                          setChosen(p.label);
                          setPickOpen(false);
                        }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '12px 14px', borderRadius: 10,
                          border: on ? '1px solid #6366f1' : '1px solid #1e293b',
                          background: on ? 'rgba(99,102,241,0.12)' : '#0f172a' }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 5 }}>{p.label}</span>
                        <span style={{ display: 'block', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55 }}>
                          <b style={{ color: '#a5b4fc' }}>{t('Mục tiêu:', 'Goal:')}</b> {p.goal}
                        </span>
                        <span style={{ display: 'block', fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55, marginTop: 3 }}>
                          <b style={{ color: '#fbbf24' }}>{t('Gửi cho:', 'Send to:')}</b> {p.who}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {field(t('Người gửi (khách sẽ thấy tên này)', 'Sender name (what customers see)'), null,
            <input value={d.fromName} onChange={(e) => setD({ ...d, fromName: e.target.value })}
              placeholder={t('Lux Nail Spa', 'Lux Nail Spa')} style={{ ...ui.input, width: '100%' }} />)}

          {field(t('Tiêu đề email', 'Subject line'),
            t('Dòng quyết định khách có mở mail hay không. Ngắn, cụ thể, đừng viết hoa hết.',
              'This decides whether the email gets opened. Short, specific, no ALL CAPS.'),
            <input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })}
              placeholder={t('Ưu đãi tháng 7 — giảm 20% cho khách quay lại', 'July offer — 20% off your next visit')}
              style={{ ...ui.input, width: '100%' }} />)}

          {field(t('Dòng xem trước (preheader)', 'Preview line (preheader)'),
            t('Dòng chữ xám hiện cạnh tiêu đề trong hộp thư.', 'The grey line shown next to the subject in the inbox.'),
            <input value={d.preheader} onChange={(e) => setD({ ...d, preheader: e.target.value })}
              style={{ ...ui.input, width: '100%' }} />)}

          {field(t('Tiêu đề lớn trong email', 'Headline inside the email'), null,
            <input value={d.heading} onChange={(e) => setD({ ...d, heading: e.target.value })}
              placeholder={t('Chào {{name}}, tháng này tiệm có ưu đãi mới', 'Hi {{name}}, we have something for you')}
              style={{ ...ui.input, width: '100%' }} />)}

          {field(t('Nội dung', 'Body'),
            t('Dòng trống = đoạn mới. {{name}} = tên khách. Ngoài ra: "## Tiêu đề", "- gạch đầu dòng", "[[NOTE]] ghi chú", "[[DIVIDER]]", và thẻ giá: "[[PLAN]] Tên | $45/tháng | mô tả | ý 1; ý 2" (dùng [[PLAN*]] cho gói muốn làm nổi bật).',
              'Blank line = new paragraph. {{name}} = customer name. Also: "## Heading", "- bullet", "[[NOTE]] small print", "[[DIVIDER]]", and price cards: "[[PLAN]] Name | $45/mo | tagline | item; item" (use [[PLAN*]] for the one you want highlighted).'),
            <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={10}
              style={{ ...ui.input, width: '100%', resize: 'vertical', lineHeight: 1.6, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />)}

          {field(t('Ảnh (dán link ảnh)', 'Image (paste a link)'),
            t('Bắt buộc bắt đầu bằng https://', 'Must start with https://'),
            <input value={d.imageUrl} onChange={(e) => setD({ ...d, imageUrl: e.target.value })}
              placeholder="https://…/promo.jpg" style={{ ...ui.input, width: '100%' }} />)}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
            {field(t('Chữ trên nút', 'Button label'), null,
              <input value={d.ctaLabel} onChange={(e) => setD({ ...d, ctaLabel: e.target.value })}
                placeholder={t('Đặt lịch ngay', 'Book now')} style={{ ...ui.input, width: '100%' }} />)}
            {field(t('Link đính kèm (nút bấm)', 'Link the button opens'), null,
              <input value={d.ctaUrl} onChange={(e) => setD({ ...d, ctaUrl: e.target.value })}
                placeholder="https://…" style={{ ...ui.input, width: '100%' }} />)}
          </div>

          {field(t('Ghi chú cuối mail', 'Footer note'),
            t('Ví dụ: địa chỉ tiệm, giờ mở cửa, số điện thoại.', 'e.g. your address, opening hours, phone.'),
            <input value={d.footerNote} onChange={(e) => setD({ ...d, footerNote: e.target.value })}
              style={{ ...ui.input, width: '100%' }} />)}

          {field(t('Trả lời về địa chỉ (tuỳ chọn)', 'Reply-to address (optional)'), null,
            <input value={d.replyTo} onChange={(e) => setD({ ...d, replyTo: e.target.value })}
              placeholder="salon@gmail.com" style={{ ...ui.input, width: '100%' }} />)}

          <div style={{ height: 1, background: '#1e293b', margin: '6px 0 16px' }} />

          {field(t('Người nhận — mỗi dòng một người (có tên càng tốt)', 'Recipients — one per line (a name is better)'),
            t('Có tên thì thư sẽ chào đúng tên khách, và tỉ lệ mở cao hơn hẳn. Gõ {{name}} trong nội dung là chỗ đó tự điền tên. Hệ thống tự lọc trùng và địa chỉ sai.',
              'With a name, the letter greets them properly and gets opened far more. Type {{name}} in the body and it fills in. Duplicates and bad addresses are filtered out.'),
            <textarea value={d.recipients} onChange={(e) => setD({ ...d, recipients: e.target.value })} rows={6}
              placeholder={'Anh Tuấn <tuan@gmail.com>\nChị Mai, mai@yahoo.com\nkevin@outlook.com'}
              style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />)}

          {/* Pull people straight out of the address book — the whole point of having one. */}
          {contacts.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '-6px 0 14px' }}>
              <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>{t('Lấy nhanh từ danh bạ:', 'Pull from contacts:')}</span>
              {([
                ['all', t(`Tất cả (${pickTargets('all').length})`, `All (${pickTargets('all').length})`)],
                ['new', t(`Chưa từng gửi (${pickTargets('new').length})`, `Never emailed (${pickTargets('new').length})`)],
                ['silent', t(`Đã gửi, chưa phản hồi (${pickTargets('silent').length})`, `Emailed, no reply (${pickTargets('silent').length})`)],
                ['failed', t(`Bị lỗi (${pickTargets('failed').length})`, `Failed (${pickTargets('failed').length})`)],
              ] as [PickTarget, string][]).map(([k, label]) => (
                <button key={k} onClick={() => fillFromContacts(k)} disabled={pickTargets(k).length === 0}
                  style={{ padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    border: '1px dashed #6366f1', background: 'rgba(99,102,241,0.10)', color: '#c7d2fe',
                    opacity: pickTargets(k).length === 0 ? 0.4 : 1 }}>
                  + {label}
                </button>
              ))}
            </div>
          )}

          {d.recipients.trim() && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '-6px 0 14px' }}>
              <span style={pill('#22c55e')}>{parsed.valid.length} {t('địa chỉ hợp lệ', 'valid')}</span>
              {parsed.invalid.length > 0 && <span style={pill('#ef4444')}>{parsed.invalid.length} {t('sai định dạng', 'invalid')}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t('Gửi thử tới email của bạn', 'Send a test to your email')}
              style={{ ...ui.input, flex: 1, minWidth: 200 }} />
            <button onClick={sendTest} disabled={busy || !testTo || !d.subject || !d.fromName}
              style={{ ...ui.primaryBtn, background: '#334155', opacity: busy || !testTo || !d.subject || !d.fromName ? 0.5 : 1 }}>
              {t('Gửi thử', 'Send test')}
            </button>
          </div>

          {!confirm ? (
            <button onClick={() => setConfirm(true)} disabled={busy || !canSend}
              style={{ ...ui.primaryBtn, width: '100%', padding: '14px', fontSize: 15, opacity: busy || !canSend ? 0.5 : 1 }}>
              {t(`Gửi cho ${parsed.valid.length} khách hàng`, `Send to ${parsed.valid.length} people`)}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirm(false)} style={{ ...ui.primaryBtn, flex: 1, background: '#334155' }}>
                {t('Huỷ', 'Cancel')}
              </button>
              <button onClick={sendAll} disabled={busy}
                style={{ ...ui.primaryBtn, flex: 2, background: '#16a34a', padding: '14px' }}>
                {busy ? '…' : t(`Chắc chắn gửi ${parsed.valid.length} email`, `Confirm — send ${parsed.valid.length} emails`)}
              </button>
            </div>
          )}
          <p style={{ color: '#64748b', fontSize: 11.5, margin: '10px 0 0', lineHeight: 1.55 }}>
            {t('Mỗi email đều có nút "Unsubscribe". Ai đã huỷ nhận thì lần sau hệ thống tự bỏ qua — luật email marketing ở Mỹ/Canada bắt buộc điều này.',
               'Every email carries an unsubscribe link. Anyone who opts out is skipped on every future send — US/Canada email law requires it.')}
          </p>

          <button onClick={addStepFromDraft} disabled={busy || !d.subject.trim()}
            style={{ width: '100%', marginTop: 10, padding: '11px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              border: '1px dashed #6366f1', background: 'transparent', color: '#c7d2fe', opacity: d.subject.trim() ? 1 : 0.5 }}>
            {t('🔁 Dùng lá thư này cho chuỗi gửi tự động →', '🔁 Add this letter to the follow-up sequence →')}
          </button>
        </div>

        {/* ---------------- live preview ---------------- */}
        <div style={{ position: 'sticky', top: 12 }}>
          <div style={{ ...ui.card, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{t('Xem trước', 'Live preview')}</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{t('đúng như khách sẽ thấy', 'exactly what lands in the inbox')}</span>
            </div>
            <div style={{ borderRadius: 10, overflow: 'hidden', background: '#f1f5f9' }}>
              <iframe title="preview" srcDoc={html} style={{ width: '100%', height: 560, border: 0, display: 'block' }} />
            </div>
          </div>
        </div>
      </div>

      )}

      {/* ---------------- address book ---------------- */}
      {tab === 'contacts' && (
      <div>
        {/* import */}
        <div style={{ ...ui.card, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            {t('Nhập danh sách khách hàng', 'Import your list')}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.6 }}>
            {t('Mỗi dòng một người. Có tên thì email sẽ chào đúng tên — mở mail cao hơn hẳn. Cả bốn kiểu dưới đây đều được:',
               'One person per line. With a name, the email greets them properly — which lifts open rates a lot. All four forms work:')}
          </p>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#a5b4fc', background: '#0f172a',
            border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', marginBottom: 10, lineHeight: 1.9 }}>
            Anh Tuấn &lt;tuan@gmail.com&gt;<br />
            tuan@gmail.com, Anh Tuấn<br />
            Chị Mai, mai@yahoo.com<br />
            kevin@outlook.com
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5}
            placeholder={'Anh Tuấn <tuan@gmail.com>\nChị Mai, mai@yahoo.com'}
            style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
          <button onClick={importList} disabled={busy || !importText.trim()}
            style={{ ...ui.primaryBtn, opacity: busy || !importText.trim() ? 0.5 : 1 }}>
            {t('Nhập vào danh bạ', 'Import into contacts')}
          </button>
          <p style={{ color: '#64748b', fontSize: 11.5, margin: '8px 0 0' }}>
            {t('Người đã có trong danh bạ sẽ được cập nhật tên, không bị nhân đôi. Xuất CSV từ Excel rồi dán thẳng vào đây cũng được.',
               'Existing people are updated, never duplicated. You can export a CSV from Excel and paste it straight in.')}
          </p>
        </div>

        {/* Mark replies in bulk — works today, no DNS setup needed. */}
        <div style={{ ...ui.card, marginBottom: 16, borderColor: '#b45309' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            {t('💬 Đánh dấu người đã phản hồi', '💬 Mark people who replied')}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.65 }}>
            {t('Dán email của những người đã trả lời thư, hoặc đã gọi điện cho anh chị. Hệ thống sẽ NGỪNG gửi nhắc tự động cho họ ngay lập tức — một lá thư máy rơi vào hộp thư của người vừa nói chuyện với anh chị hôm qua là cách nhanh nhất để mất họ.',
               'Paste the addresses of anyone who replied — or who phoned you. The follow-up stops for them immediately. An automated “just checking in” landing after a real conversation is the fastest way to lose a prospect.')}
          </p>
          <textarea value={repliedText} onChange={(e) => setRepliedText(e.target.value)} rows={3}
            placeholder={'tuan@gmail.com\nmai@yahoo.com'}
            style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
          <button onClick={markRepliedBulk} disabled={busy || !repliedText.trim()}
            style={{ ...ui.primaryBtn, background: '#b45309', opacity: busy || !repliedText.trim() ? 0.5 : 1 }}>
            {t('Đánh dấu đã phản hồi — ngừng nhắc', 'Mark as replied — stop chasing')}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{t('Danh bạ', 'Contacts')}</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>{t(`${contacts.length} người`, `${contacts.length} people`)}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>
          {t('Ai đã nhận mấy lá thư, lá cuối là mẫu nào, có tới nơi không. Ai đã phản hồi thì đánh dấu — hệ thống sẽ KHÔNG gửi nhắc tự động cho họ nữa.',
             'How many letters each person has had, which one, and whether it landed. Mark anyone who replied — the automation will never chase them again.')}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {([
            ['all', t(`Tất cả (${stats.all})`, `All (${stats.all})`), '#818cf8'],
            ['new', t(`🆕 Chưa gửi (${stats.fresh})`, `🆕 Never emailed (${stats.fresh})`), '#38bdf8'],
            ['ok', t(`✅ Đã gửi (${stats.ok})`, `✅ Emailed (${stats.ok})`), '#22c55e'],
            ['failed', t(`❌ Lỗi (${stats.failed})`, `❌ Failed (${stats.failed})`), '#ef4444'],
            ['replied', t(`💬 Đã phản hồi (${stats.replied})`, `💬 Replied (${stats.replied})`), '#fbbf24'],
            ['unsub', t(`🚫 Huỷ nhận (${stats.unsub})`, `🚫 Unsubscribed (${stats.unsub})`), '#94a3b8'],
          ] as [ContactFilter, string, string][]).map(([k, label, col]) => {
            const on = cFilter === k;
            return (
              <button key={k} onClick={() => { setCFilter(k); setPicked(new Set()); }}
                style={{ padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  border: `1px solid ${on ? col : '#334155'}`, background: on ? col : 'transparent', color: on ? '#0b1120' : '#cbd5e1' }}>
                {label}
              </button>
            );
          })}
          <input value={cQuery} onChange={(e) => setCQuery(e.target.value)}
            placeholder={t('Tìm tên hoặc email…', 'Search a name or address…')}
            style={{ ...ui.input, marginBottom: 0, flex: 1, minWidth: 180 }} />
        </div>

        {visibleContacts.filter((c) => !c.unsubscribed && !c.replied).length > 0 && (
          <button
            onClick={() => {
              const rows = visibleContacts.filter((c) => !c.unsubscribed && !c.replied);
              setD((prev) => ({ ...prev, recipients: asLines(rows) }));
              setTab('compose');
              setPickOpen(true);
              setOk(t(`Đã đưa ${rows.length} người vào ô người nhận. Chọn mẫu, xem trước, gửi thử, rồi gửi thật.`,
                      `${rows.length} people loaded into the composer.`));
            }}
            style={{ ...ui.primaryBtn, width: '100%', marginBottom: 12, background: '#16a34a', padding: '13px', fontSize: 14.5 }}>
            {t(`✉️ Soạn thư gửi cả nhóm này (${visibleContacts.filter((c) => !c.unsubscribed && !c.replied).length} người) →`,
               `✉️ Write to this whole group (${visibleContacts.filter((c) => !c.unsubscribed && !c.replied).length}) →`)}
          </button>
        )}

        {visibleContacts.length === 0 ? (
          <div style={{ ...ui.card, color: '#64748b', fontSize: 13.5 }}>{t('Chưa có ai trong nhóm này.', 'Nobody in this group yet.')}</div>
        ) : (
          <div style={{ ...ui.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
              <input type="checkbox" checked={allPicked} onChange={toggleAll}
                style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('Người nhận', 'Person')}
              </span>
              <span style={{ width: 62, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {t('Số lần', 'Sends')}
              </span>
              <span style={{ width: 170, fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {t('Lần cuối', 'Last')}
              </span>
              <span style={{ width: 108, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {t('Phản hồi', 'Replied')}
              </span>
            </div>

            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {visibleContacts.map((c) => {
                const on = picked.has(c.email);
                const locked = c.unsubscribed || c.replied; // never chase these two
                const dot = c.unsubscribed ? '#94a3b8' : c.replied ? '#fbbf24'
                  : c.sends === 0 ? '#38bdf8' : c.lastStatus === 'failed' ? '#ef4444' : '#22c55e';
                return (
                  <div key={c.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid #1e293b',
                      background: on ? 'rgba(99,102,241,0.10)' : 'transparent', opacity: c.unsubscribed ? 0.55 : 1 }}>
                    <input type="checkbox" checked={on} disabled={c.unsubscribed}
                      onChange={() => togglePick(c.email)}
                      style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: c.unsubscribed ? 'not-allowed' : 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <input value={c.name ?? ''} onChange={(e) => renameContact(c, e.target.value)}
                          placeholder={t('+ thêm tên', '+ add a name')}
                          style={{ width: 130, flexShrink: 0, background: 'transparent', border: '1px solid transparent', borderRadius: 6,
                            padding: '2px 6px', color: c.name ? '#e2e8f0' : '#64748b', fontSize: 13.5, fontWeight: c.name ? 700 : 400 }} />
                        <span style={{ minWidth: 0, fontSize: 13, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.email}
                        </span>
                      </span>
                      {c.lastError && !c.unsubscribed && (
                        <span title={c.lastError} style={{ display: 'block', fontSize: 11.5, color: '#f87171', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.lastError}
                        </span>
                      )}
                    </span>
                    <span style={{ width: 62, textAlign: 'center', flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: c.sends > 2 ? '#fbbf24' : c.sends ? '#cbd5e1' : '#475569' }}>
                      {c.sends}×
                    </span>
                    <span style={{ width: 170, flexShrink: 0, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.lastCampaign}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {c.lastSentAt ? new Date(c.lastSentAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short' }) : t('chưa gửi', 'never')}
                      </span>
                    </span>
                    <span style={{ width: 108, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <button onClick={() => markReplied(c, !c.replied)} disabled={c.unsubscribed}
                        title={t('Khách đã trả lời / đã gọi điện — hệ thống sẽ ngừng gửi nhắc tự động', 'They answered — the automation will stop chasing them')}
                        style={{ padding: '5px 10px', borderRadius: 999, cursor: c.unsubscribed ? 'not-allowed' : 'pointer', fontSize: 11.5, fontWeight: 700,
                          border: `1px solid ${c.replied ? '#fbbf24' : '#334155'}`,
                          background: c.replied ? 'rgba(251,191,36,0.15)' : 'transparent',
                          color: c.replied ? '#fbbf24' : '#64748b', whiteSpace: 'nowrap' }}>
                        {c.replied ? t('💬 Đã trả lời', '💬 Replied') : t('Đánh dấu', 'Mark')}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {picked.size > 0 && (
          <div style={{ position: 'sticky', bottom: 12, zIndex: 20, marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 16px', borderRadius: 12, background: '#1e293b', border: '1px solid #6366f1', boxShadow: '0 10px 30px rgba(2,6,23,0.5)' }}>
            <span style={{ flex: 1, minWidth: 160, fontSize: 14, color: '#e2e8f0' }}>
              {t(`Đã chọn ${picked.size} người`, `${picked.size} selected`)}
            </span>
            <button onClick={() => setPicked(new Set())} style={{ ...ui.primaryBtn, background: '#334155' }}>{t('Bỏ chọn', 'Clear')}</button>
            <button onClick={reuse} style={{ ...ui.primaryBtn, background: '#16a34a' }}>
              {t(`Soạn thư gửi ${picked.size} người này →`, `Write to these ${picked.size} →`)}
            </button>
          </div>
        )}
      </div>
      )}

      {/* ---------------- the follow-up ---------------- */}
      {tab === 'auto' && auto && (
      <div style={{ maxWidth: 760 }}>
        <div style={{ ...ui.card, marginBottom: 16, borderColor: auto.enabled ? '#16a34a' : '#334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={auto.enabled} disabled={busy}
                onChange={(e) => saveAuto({ enabled: e.target.checked })}
                style={{ width: 20, height: 20, accentColor: '#16a34a', cursor: 'pointer' }} />
              <span style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>
                {t('Tự động gửi nhắc lại', 'Automatic follow-up')}
              </span>
            </label>
            <span style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
              background: auto.enabled ? '#16a34a' : '#334155', color: auto.enabled ? '#fff' : '#94a3b8' }}>
              {auto.enabled ? t('ĐANG BẬT', 'ON') : t('ĐANG TẮT', 'OFF')}
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '10px 0 0', lineHeight: 1.65 }}>
            {t('Mỗi ngày hệ thống tự rà danh bạ. Ai chưa phản hồi, chưa huỷ nhận, và đã quá số ngày cách nhau bên dưới thì được gửi lá thư TIẾP THEO trong chuỗi — không phải lá cũ.',
               'Every day the system sweeps the list. Anyone who has not replied, has not unsubscribed, and whose gap has passed gets the NEXT letter in the sequence — never the same one twice.')}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
            <div style={{ ...ui.card, padding: 12, background: '#0f172a' }}>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{t('Đang chờ gửi', 'Due now')}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#a5b4fc', marginTop: 4 }}>{auto.dueNow}</div>
            </div>
            <div style={{ ...ui.card, padding: 12, background: '#0f172a' }}>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{t('Đã gửi tự động', 'Sent so far')}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#4ade80', marginTop: 4 }}>{auto.sentTotal}</div>
            </div>
            <div style={{ ...ui.card, padding: 12, background: '#0f172a' }}>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{t('Chạy lần cuối', 'Last run')}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginTop: 6 }}>
                {auto.lastRunAt ? new Date(auto.lastRunAt).toLocaleString(vi ? 'vi-VN' : 'en-US') : t('chưa chạy', 'never')}
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...ui.card, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('Cài đặt', 'Settings')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={ui.label}>{t('Cách nhau bao nhiêu ngày', 'Days between letters')}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[14, 21, 30, 45, 60].map((n) => {
                  const on = auto.everyDays === n;
                  return (
                    <button key={n} onClick={() => saveAuto({ everyDays: n })} disabled={busy}
                      style={{ padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                        border: on ? '1px solid #6366f1' : '1px solid #334155',
                        background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#cbd5e1' }}>
                      {n} {t('ngày', 'days')}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={ui.label}>{t('Tối đa mỗi ngày', 'Cap per day')}</label>
              <input type="number" value={auto.dailyCap} min={10} max={500}
                onChange={(e) => setAuto({ ...auto, dailyCap: Number(e.target.value) })}
                onBlur={() => saveAuto({ dailyCap: auto.dailyCap })}
                style={{ ...ui.input, width: '100%' }} />
              <p style={{ color: '#64748b', fontSize: 11.5, margin: '4px 0 0' }}>
                {t('Gói Brevo miễn phí chỉ cho 300 mail/ngày — để 100 là an toàn.', 'The free Brevo plan allows 300/day — 100 is a safe cap.')}
              </p>
            </div>
          </div>
        </div>

        <div style={{ ...ui.card }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
            {t(`Chuỗi thư (${auto.steps.length}/5)`, `The sequence (${auto.steps.length}/5)`)}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.6 }}>
            {t('Lá thứ 1 gửi cho người mới. Ai im lặng thì lá thứ 2 gửi sau đó — và phải là NỘI DUNG KHÁC. Gửi lại y hệt lá cũ là cách nhanh nhất để bị bấm spam.',
               'Letter 1 goes to a new contact. If they stay silent, letter 2 follows — and it must say something DIFFERENT. Resending the same letter is the fastest way to get marked as spam.')}
          </p>

          {auto.steps.length === 0 ? (
            <div style={{ padding: '20px 16px', borderRadius: 10, border: '1px dashed #334155', textAlign: 'center', color: '#64748b', fontSize: 13.5 }}>
              {t('Chưa có lá thư nào. Sang tab “Soạn & gửi”, chọn một mẫu, rồi bấm “Dùng lá thư này cho chuỗi gửi tự động”.',
                 'No letters yet. Go to Compose, pick a template, then click “Add this letter to the follow-up sequence”.')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {auto.steps.map((st, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10,
                  background: '#0f172a', border: '1px solid #1e293b' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: '#6366f1', color: '#fff',
                    display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {st.subject}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                      {i === 0
                        ? t('Gửi ngay khi thêm người mới vào danh bạ', 'Sent as soon as a new contact is added')
                        : t(`Gửi ${auto.everyDays} ngày sau lá ${i}, nếu vẫn im lặng`, `Sent ${auto.everyDays} days after letter ${i}, if still silent`)}
                    </span>
                  </span>
                  <button onClick={() => saveAuto({ steps: auto.steps.filter((_, j) => j !== i) })} disabled={busy}
                    style={{ flexShrink: 0, background: 'none', border: 0, color: '#ef4444', fontSize: 20, cursor: 'pointer' }}>&times;</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={() => setTab('compose')} style={{ ...ui.primaryBtn, background: '#334155' }}>
              {t('+ Soạn thêm một lá', '+ Write another letter')}
            </button>
            <button onClick={runAutoNow} disabled={busy || !auto.enabled}
              style={{ ...ui.primaryBtn, opacity: busy || !auto.enabled ? 0.5 : 1 }}>
              {t('▶ Chạy ngay (không đợi tới ngày mai)', '▶ Run now')}
            </button>
          </div>

          <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.10)', border: '1px solid #b45309' }}>
            <p style={{ color: '#fde68a', fontSize: 12.5, margin: 0, lineHeight: 1.65 }}>
              <b>{t('Luật vàng:', 'The rule that matters:')}</b>{' '}
              {t('Ai đã trả lời anh chị, hoặc đã gọi điện, thì vào tab Danh bạ bấm “Đánh dấu” — hệ thống sẽ KHÔNG bao giờ gửi nhắc tự động cho họ nữa. Một lá thư tự động rơi vào hộp thư của người vừa gọi cho anh chị hôm qua là cách nhanh nhất để mất họ.',
                 'The moment someone replies or calls you, open Contacts and mark them. The robot will never chase them again. An automated “just checking in” landing after a real conversation is the fastest way to lose a prospect.')}
            </p>
          </div>
        </div>
      </div>
      )}

      {/* ---------------- outbox ---------------- */}
      {tab === 'outbox' && (
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{t('Hộp thư đi', 'Outbox')}</div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>
          {t('Mọi lần gửi đều được lưu: gửi cho ai, lúc nào, tới nơi hay lỗi.', 'Every send is kept: who it went to, when, and whether it landed.')}
        </p>
        {list.length === 0 ? (
          <div style={{ ...ui.card, color: '#64748b', fontSize: 13.5 }}>{t('Chưa gửi chiến dịch nào.', 'No campaigns sent yet.')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {list.map((c) => {
              const st = STATUS[c.status] ?? STATUS.draft;
              return (
                <button key={c.id} onClick={async () => {
                  try { setOpen(await apiFetch<CampaignDetail>(`${base}/${c.id}`, { token })); } catch { /* ignore */ }
                }}
                  style={{ ...ui.card, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.subject}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 3 }}>
                      {new Date(c.sentAt ?? c.createdAt).toLocaleString(vi ? 'vi-VN' : 'en-US')}
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={pill('#22c55e')}>{c.sent} {t('đã gửi', 'sent')}</span>
                    {c.failed > 0 && <span style={pill('#ef4444')}>{c.failed} {t('lỗi', 'failed')}</span>}
                    {c.skipped > 0 && <span style={pill('#94a3b8')}>{c.skipped} {t('bỏ qua', 'skipped')}</span>}
                    <span style={pill(st.c)}>{st.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      )}

      {open && <CampaignSheet c={open} vi={vi} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CampaignSheet({ c, vi, onClose }: { c: CampaignDetail; vi: boolean; onClose: () => void }) {
  const t = (v: string, e: string) => (vi ? v : e);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(2,6,23,0.75)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: '100%', maxWidth: 880, maxHeight: '86vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>{c.subject}</span>
          <button onClick={onClose} style={{ background: 'none', border: 0, color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={pill('#22c55e')}>{c.sent} {t('đã gửi', 'sent')}</span>
          {c.failed > 0 && <span style={pill('#ef4444')}>{c.failed} {t('lỗi', 'failed')}</span>}
          {c.skipped > 0 && <span style={pill('#94a3b8')}>{c.skipped} {t('bỏ qua', 'skipped')}</span>}
          <span style={pill('#818cf8')}>{c.total} {t('tổng cộng', 'total')}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{t('Người nhận', 'Recipients')}</div>
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 4 }}>
              {c.recipients.map((r) => {
                const col = r.status === 'sent' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#94a3b8';
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: '#0f172a', border: '1px solid #1e293b' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: col, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
                    {r.error && <span title={r.error} style={{ fontSize: 11, color: '#f87171', flexShrink: 0 }}>{t('lỗi', 'failed')}</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{t('Email đã gửi', 'What was sent')}</div>
            <div style={{ borderRadius: 10, overflow: 'hidden', background: '#f1f5f9' }}>
              <iframe title="sent" srcDoc={c.html ?? ''} style={{ width: '100%', height: 420, border: 0, display: 'block' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const pill = (c: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 700, color: c, border: `1px solid ${c}`,
  borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
});
