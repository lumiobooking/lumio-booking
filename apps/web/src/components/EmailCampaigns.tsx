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
  email: string;
  sends: number; sent: number; failed: number; skipped: number;
  lastStatus: string; lastAt: string | null; lastError: string | null;
  lastCampaign: string; unsubscribed: boolean;
}
type ContactFilter = 'all' | 'ok' | 'failed' | 'unsub';
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

  const t = (v: string, e: string) => (vi ? v : e);

  const loadList = useCallback(async () => {
    if (!token) return;
    try { setList(await apiFetch<Campaign[]>(base, { token })); } catch { /* ignore */ }
    try { setContacts(await apiFetch<Contact[]>(`${base}/contacts`, { token })); } catch { /* ignore */ }
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
    ok: contacts.filter((c) => c.lastStatus === 'sent' && !c.unsubscribed).length,
    failed: contacts.filter((c) => c.lastStatus === 'failed' && !c.unsubscribed).length,
    unsub: contacts.filter((c) => c.unsubscribed).length,
  }), [contacts]);

  const visibleContacts = useMemo(() => {
    const q = cQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      if (q && !c.email.includes(q)) return false;
      if (cFilter === 'ok') return c.lastStatus === 'sent' && !c.unsubscribed;
      if (cFilter === 'failed') return c.lastStatus === 'failed' && !c.unsubscribed;
      if (cFilter === 'unsub') return c.unsubscribed;
      return true;
    });
  }, [contacts, cFilter, cQuery]);

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

  /** Drop the picked addresses into the composer. The template is deliberately NOT
   *  reused: someone who ignored Form 1 should get Form 2, not Form 1 again. */
  const reuse = () => {
    setD({ ...d, recipients: [...picked].join(', ') });
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

          {field(t('Danh sách email khách hàng', 'Customer email list'),
            t('Dán cả loạt — cách nhau bằng dấu phẩy, dấu cách hoặc xuống dòng. Hệ thống tự lọc trùng và địa chỉ sai.',
              'Paste them all — separated by commas, spaces or new lines. Duplicates and bad addresses are filtered out.'),
            <textarea value={d.recipients} onChange={(e) => setD({ ...d, recipients: e.target.value })} rows={5}
              placeholder={'anna@gmail.com, kevin@yahoo.com\nmai@outlook.com'}
              style={{ ...ui.input, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />)}

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

      {/* ---------------- address book ---------------- */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>
            {t('Danh bạ đã gửi', 'Everyone you have emailed')}
          </span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {t(`${contacts.length} địa chỉ`, `${contacts.length} addresses`)}
          </span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>
          {t('Gộp theo từng người: đã gửi mấy lần, mẫu nào, lần cuối có tới nơi không. Tick để gửi lại — chọn mẫu khác hoặc tự viết.',
             'One row per person: how many times, which template, and whether the last one landed. Tick to send again — with a different template, or your own words.')}
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {([
            ['all', t(`Tất cả (${stats.all})`, `All (${stats.all})`), '#818cf8'],
            ['ok', t(`✅ Đã tới (${stats.ok})`, `✅ Delivered (${stats.ok})`), '#22c55e'],
            ['failed', t(`❌ Lỗi (${stats.failed})`, `❌ Failed (${stats.failed})`), '#ef4444'],
            ['unsub', t(`🚫 Đã huỷ nhận (${stats.unsub})`, `🚫 Unsubscribed (${stats.unsub})`), '#94a3b8'],
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
            placeholder={t('Tìm email…', 'Search an address…')}
            style={{ ...ui.input, marginBottom: 0, flex: 1, minWidth: 180 }} />
        </div>

        {visibleContacts.length === 0 ? (
          <div style={{ ...ui.card, color: '#64748b', fontSize: 13.5 }}>
            {t('Chưa có ai trong nhóm này.', 'Nobody in this group yet.')}
          </div>
        ) : (
          <div style={{ ...ui.card, padding: 0, overflow: 'hidden' }}>
            {/* header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
              <input type="checkbox" checked={allPicked} onChange={toggleAll}
                style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('Địa chỉ', 'Address')}
              </span>
              <span style={{ width: 70, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {t('Số lần', 'Sends')}
              </span>
              <span style={{ width: 190, fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                {t('Lần cuối', 'Last send')}
              </span>
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {visibleContacts.map((c) => {
                const on = picked.has(c.email);
                const dot = c.unsubscribed ? '#94a3b8' : c.lastStatus === 'sent' ? '#22c55e' : c.lastStatus === 'failed' ? '#ef4444' : '#f59e0b';
                return (
                  <label key={c.email}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid #1e293b',
                      cursor: c.unsubscribed ? 'not-allowed' : 'pointer', background: on ? 'rgba(99,102,241,0.10)' : 'transparent',
                      opacity: c.unsubscribed ? 0.55 : 1 }}>
                    <input type="checkbox" checked={on} disabled={c.unsubscribed}
                      onChange={() => togglePick(c.email)}
                      style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.email}
                        {c.unsubscribed && <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>({t('đã huỷ nhận', 'unsubscribed')})</span>}
                      </span>
                      {c.lastError && !c.unsubscribed && (
                        <span title={c.lastError} style={{ display: 'block', fontSize: 11.5, color: '#f87171', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.lastError}
                        </span>
                      )}
                    </span>
                    <span style={{ width: 70, textAlign: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: c.sends > 1 ? '#fbbf24' : '#94a3b8' }}>{c.sends}×</span>
                    </span>
                    <span style={{ width: 190, flexShrink: 0, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.lastCampaign}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {c.lastAt ? new Date(c.lastAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* the whole point: take these people back to the composer */}
        {picked.size > 0 && (
          <div style={{ position: 'sticky', bottom: 12, zIndex: 20, marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '12px 16px', borderRadius: 12, background: '#1e293b', border: '1px solid #6366f1', boxShadow: '0 10px 30px rgba(2,6,23,0.5)' }}>
            <span style={{ flex: 1, minWidth: 160, fontSize: 14, color: '#e2e8f0' }}>
              {t(`Đã chọn ${picked.size} người`, `${picked.size} selected`)}
            </span>
            <button onClick={() => setPicked(new Set())}
              style={{ ...ui.primaryBtn, background: '#334155' }}>{t('Bỏ chọn', 'Clear')}</button>
            <button onClick={reuse}
              style={{ ...ui.primaryBtn, background: '#16a34a' }}>
              {t(`Gửi lại cho ${picked.size} người →`, `Email these ${picked.size} again →`)}
            </button>
          </div>
        )}
      </div>

      {/* ---------------- outbox ---------------- */}
      <div style={{ marginTop: 20 }}>
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
