'use client';

/**
 * Gửi ảnh từ Hộp thư (19/11/2026): the picture button opens this panel.
 *
 *   Gợi ý     — library pictures that fit what the customer last wrote, best
 *               first; already-sent ones last and marked; flagged ones locked.
 *   Thư viện  — every picture in the salon's library, searchable.
 *   Từ máy    — the old way: pick a file from this device.
 *
 * Above the reply box, PhotoWaiting shows what the AI is holding for a person
 * ("Nhân viên duyệt" in the salon's rules) with one tap to send.
 *
 * Every send goes through the server, which checks the picture and the
 * conversation both belong to the caller's salon and that Meta's window is open.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { blockedLabel, filterItems, kindLabel, payLine, vnd, type LibraryResponse, type PayPanel, type SuggestItem, type SuggestResponse } from '../../lib/photo-library';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);
// White on a dark scrim over a PHOTO (never a themed surface): the scrim does not flip in light mode.
const badge = (bg: string): CSSProperties => ({ position: 'absolute', top: 4, left: 4, fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: bg, color: '#fff', maxWidth: 'calc(100% - 8px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

/** The suggestions for one conversation, refetched when the conversation moves on. */
export function usePhotoSuggest(token: string | null, threadId: string | null, key: string | number) {
  const [data, setData] = useState<SuggestResponse | null>(null);
  const load = useCallback(async () => {
    if (!token || !threadId) { setData(null); return; }
    try { setData(await apiFetch<SuggestResponse>(`/messenger/threads/${threadId}/photo-suggest`, { token })); }
    catch { setData(null); }
  }, [token, threadId]);
  useEffect(() => { void load(); }, [load, key]);
  return { data, reload: load };
}

async function sendItem(token: string, threadId: string, itemId: string) {
  await apiFetch(`/messenger/threads/${threadId}/photo-library`, { method: 'POST', token, body: { itemId } });
}

const thumb: CSSProperties = { position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', padding: 0, cursor: 'pointer', background: 'var(--c1e293b)' };

export function PhotoWaiting({ token, threadId, vi, suggest, onSent, onError, disabled }: {
  token: string | null; threadId: string; vi: boolean; suggest: SuggestResponse | null; onSent: () => void; onError: (m: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const w = suggest?.waiting;
  const pay = (suggest?.pay ?? []).slice(0, 2);
  if (!token || (!w && !pay.length)) return null;
  const payRows = pay.map((r) => {
    const l = payLine(r, vi);
    return (
      <div key={r.code} role="status" style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid var(--line)', fontSize: 12.5, fontWeight: 700,
        background: l.tone === 'ok' ? 'var(--wash-green, var(--wash-blue))' : l.tone === 'warn' ? 'var(--wash-amber-3)' : 'var(--wash-blue)',
        color: l.tone === 'ok' ? 'var(--ink-good)' : l.tone === 'warn' ? 'var(--ink-warn)' : 'var(--ink-link)' }}>💳 {l.text}</div>
    );
  });
  if (!w) return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{payRows}</div>;
  const sendAll = async () => {
    setBusy(true);
    try { for (const it of w.items) await sendItem(token, threadId, it.id); onSent(); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  };
  const skip = async () => {
    setBusy(true);
    try { await apiFetch(`/messenger/threads/${threadId}/photo-waiting/clear`, { method: 'POST', token }); onSent(); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {payRows}
    <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--wash-amber-3)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-warn)', fontWeight: 700, flex: '1 1 180px', minWidth: 0 }}>
        {w.items.length
          ? L(vi, `AI muốn gửi ${w.items.length} ảnh “${w.label}” — chờ anh/chị duyệt`, `The AI wants to send ${w.items.length} “${w.label}” photo(s) — waiting for you`)
          : L(vi, `Khách hỏi ảnh “${w.label}” nhưng thư viện chưa có ảnh khớp`, `The customer asked for “${w.label}” photos — none in the library fit`)}
      </span>
      {w.items.map((it) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={it.id} src={it.url} alt={it.title} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, background: 'var(--c1e293b)' }} />
      ))}
      {w.items.length > 0 && (
        <button type="button" disabled={busy || disabled} onClick={() => void sendAll()}
          style={{ minHeight: 36, padding: '0 14px', borderRadius: 10, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: busy || disabled ? 0.6 : 1 }}>
          {busy ? L(vi, 'Đang gửi…', 'Sending…') : L(vi, 'Duyệt và gửi', 'Approve & send')}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => void skip()}
        style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
        {L(vi, 'Bỏ qua', 'Dismiss')}
      </button>
    </div>
    </div>
  );
}

/** Under a customer's picture in the chat (owner): keep it in the library — locked for the AI until the customer agrees. */
export function SaveToLibrary({ token, threadId, url, vi }: { token: string | null; threadId: string; url: string; vi: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  if (!token) return null;
  const save = async () => {
    setState('busy');
    try { await apiFetch(`/messenger/threads/${threadId}/save-photo`, { method: 'POST', token, body: { url, kind: 'result' } }); setState('done'); }
    catch (e) { setMsg(String(e).replace(/^Error:\s*/, '').slice(0, 120)); setState('err'); }
  };
  if (state === 'done') return <span style={{ fontSize: 11.5, color: 'var(--ink-good)', fontWeight: 700 }}>{L(vi, '✓ Đã lưu — cần khách đồng ý mới dùng', '✓ Saved — needs consent before use')}</span>;
  return (
    <button type="button" disabled={state === 'busy'} onClick={() => void save()} title={state === 'err' ? msg : L(vi, 'Lưu ảnh này vào Thư viện ảnh gửi khách (AI không dùng tới khi khách đồng ý)', 'Keep this picture in the photo library (locked until the customer agrees)')}
      style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: state === 'err' ? 'var(--ink-bad)' : 'var(--ink-link)' }}>
      {state === 'busy' ? L(vi, 'Đang lưu…', 'Saving…') : state === 'err' ? L(vi, 'Không lưu được', 'Not saved') : L(vi, '＋ Lưu vào thư viện', '＋ Save to library')}
    </button>
  );
}

/** The deposit QR tab: a person decides the amount and sends; the server uses the salon's own account. */
function PayTab({ token, threadId, vi, disabled, onSent, onError }: { token: string | null; threadId: string; vi: boolean; disabled?: boolean; onSent: () => void; onError: (m: string) => void }) {
  const [p, setP] = useState<PayPanel | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    apiFetch<PayPanel>(`/messenger/threads/${threadId}/pay-qr`, { token }).then((x) => { setP(x); if (x.suggestedCents) setAmount(String(x.suggestedCents)); }).catch(() => setP(null));
  }, [token, threadId]);
  if (!p) return <div style={{ padding: 16, fontSize: 13.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</div>;
  if (!p.available) return (
    <div style={{ padding: '14px 8px', fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>
      {L(vi, 'Chưa gửi được QR: tiệm chưa có tài khoản ngân hàng nhận tiền (VietQR). Chủ tiệm điền ở Cài đặt › Thu ngân (POS).', 'No QR yet: the salon has no VietQR bank account. The owner adds it under Settings › POS.')}
    </div>
  );
  const n = Math.round(Number(amount.replace(/\D/g, '')) || 0);
  const send = async () => {
    if (!token || n < 1000) return;
    setBusy(true);
    try { await apiFetch(`/messenger/threads/${threadId}/pay-qr`, { method: 'POST', token, body: { amountCents: n, appointmentId: p.appointment?.id ?? null } }); onSent(); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
      <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
        {L(vi, 'Nhận vào', 'Paid to')}: <b style={{ color: 'var(--ce2e8f0)' }}>{p.bank?.name} {p.bank?.accountNo}</b>{p.bank?.accountName ? ` · ${p.bank.accountName}` : ''}
        {p.appointment && <><br />{L(vi, 'Lịch hẹn', 'Booking')}: <b style={{ color: 'var(--ce2e8f0)' }}>{p.appointment.service ?? ''} · {new Date(p.appointment.startTime).toLocaleString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></>}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' }}>
        {L(vi, 'Số tiền cọc (đồng)', 'Deposit (VND)')}
        <input inputMode="numeric" value={amount ? Number(amount.replace(/\D/g, '') || 0).toLocaleString('vi-VN') : ''} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          style={{ minHeight: 42, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 16, fontWeight: 700, fontFamily: 'inherit' }} />
      </label>
      {p.suggestedCents ? <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L(vi, `Theo quy định cọc của tiệm: ${vnd(p.suggestedCents)}`, `Salon deposit rule: ${vnd(p.suggestedCents)}`)}</span> : null}
      <span style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{L(vi, 'Khách nhận ảnh QR điền sẵn số tiền và mã (LB…). Khi khách gửi ảnh chuyển khoản hoặc ngân hàng báo tiền về, Hộp thư sẽ ghi bên cạnh — tiệm tự xác nhận.', 'The customer gets a QR with the amount and code (LB…). A transfer picture or the bank feed shows up here — the salon confirms.')}</span>
      <button type="button" disabled={busy || disabled || n < 1000} onClick={() => void send()}
        style={{ minHeight: 42, borderRadius: 12, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: busy || disabled || n < 1000 ? 0.55 : 1 }}>
        {busy ? L(vi, 'Đang gửi…', 'Sending…') : n >= 1000 ? L(vi, `Gửi QR cọc ${vnd(n)}`, `Send ${vnd(n)} QR`) : L(vi, 'Nhập số tiền', 'Enter an amount')}
      </button>
    </div>
  );
}

export function PhotoPicker({ token, threadId, vi, narrow, suggest, onClose, onSent, onUpload, onError, disabled }: {
  token: string | null; threadId: string; vi: boolean; narrow: boolean; suggest: SuggestResponse | null;
  onClose: () => void; onSent: () => void; onUpload: () => void; onError: (m: string) => void; disabled?: boolean;
}) {
  const [tab, setTab] = useState<'suggest' | 'library' | 'pay'>('suggest');
  const [lib, setLib] = useState<LibraryResponse | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // The deposit tab only for salons that can take a VietQR (Vietnam); the server decides.
  const [payOk, setPayOk] = useState(false);
  useEffect(() => {
    if (!token) return;
    apiFetch<PayPanel>(`/messenger/threads/${threadId}/pay-qr`, { token }).then((x) => setPayOk(x.reason !== 'not_vn')).catch(() => setPayOk(false));
  }, [token, threadId]);

  useEffect(() => {
    if (tab !== 'library' || lib || !token) return;
    apiFetch<LibraryResponse>('/messenger/photo-library', { token }).then(setLib).catch(() => setLib(null));
  }, [tab, lib, token]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const sentSet = useMemo(() => new Set((suggest?.suggestions ?? []).filter((s) => s.sent).map((s) => s.id)), [suggest]);
  const list: (SuggestItem | (SuggestItem & { score: number }))[] = useMemo(() => {
    if (tab === 'suggest') return suggest?.suggestions ?? [];
    const rows = lib ? filterItems(lib.items, 'all', q) : [];
    return rows.map((i) => ({
      id: i.id, url: i.url, kind: i.kind, title: i.title, serviceName: i.serviceName, tags: i.tags, score: 0, sent: sentSet.has(i.id),
      blocked: i.blocked === 'flagged' || i.blocked === 'no_consent' || i.blocked === 'expired' || i.blocked === 'price_stale' ? i.blocked : null,
    }));
  }, [tab, suggest, lib, q, sentSet]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  const send = async () => {
    if (!token || !picked.length) return;
    setBusy(true);
    try { for (const id of picked) await sendItem(token, threadId, id); setPicked([]); onSent(); onClose(); }
    catch (e) { onError(String(e)); } finally { setBusy(false); }
  };

  const tabBtn = (id: 'suggest' | 'library' | 'pay', label: string): JSX.Element => {
    const on = tab === id;
    return (
      <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)}
        style={{ minHeight: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 800 : 600,
          border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ce2e8f0)' }}>{label}</button>
    );
  };

  const shell: CSSProperties = narrow
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, maxHeight: '78vh', borderRadius: '20px 20px 0 0', padding: '10px 14px calc(14px + env(safe-area-inset-bottom))' }
    : { position: 'absolute', left: 12, bottom: 'calc(100% + 8px)', zIndex: 40, width: 'min(460px, calc(100vw - 32px))', maxHeight: 520, borderRadius: 16, padding: 14 };

  return (
    <>
      {narrow && <div aria-hidden onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 69, background: 'rgba(2,6,23,.45)' }} />}
      <div role="dialog" aria-label={L(vi, 'Gửi ảnh cho khách', 'Send a photo')}
        style={{ ...shell, boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--line)', boxShadow: '0 18px 40px rgba(2,6,23,.35)', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
        {narrow && <div aria-hidden style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--line-strong)', margin: '0 auto' }} />}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{L(vi, 'Gửi ảnh', 'Send a photo')}</b>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{picked.length ? L(vi, `đã chọn ${picked.length}/3`, `${picked.length}/3 picked`) : ''}</span>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabBtn('suggest', L(vi, 'Gợi ý', 'Suggested'))}
          {tabBtn('library', L(vi, 'Thư viện', 'Library'))}
          {payOk && tabBtn('pay', L(vi, 'QR đặt cọc', 'Deposit QR'))}
        </div>
        {tab === 'pay' && <PayTab token={token} threadId={threadId} vi={vi} disabled={disabled} onSent={() => { onSent(); onClose(); }} onError={onError} />}
        {tab === 'suggest' && suggest?.lastText ? (
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{L(vi, 'Theo câu khách hỏi: ', 'From what the customer asked: ')}<b style={{ color: 'var(--ce2e8f0)' }}>“{suggest.lastText}”</b></div>
        ) : null}
        {tab === 'library' && (
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(vi, 'Tìm: french, nude, bảng giá…', 'Find: french, nude, price…')} aria-label={L(vi, 'Tìm ảnh', 'Find a photo')}
            style={{ minHeight: 38, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14, fontFamily: 'inherit' }} />
        )}
        {tab !== 'pay' && <div style={{ overflowY: 'auto', minHeight: 120 }}>
          {list.length === 0 ? (
            <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
              {(suggest?.total ?? 0) === 0
                ? L(vi, 'Thư viện ảnh còn trống. Chủ tiệm thêm ảnh ở Trợ lý AI › Ảnh gửi khách.', 'The photo library is empty. The owner adds photos under AI › Photos for customers.')
                : tab === 'library' && !lib ? L(vi, 'Đang tải…', 'Loading…') : L(vi, 'Không có ảnh khớp.', 'No matching photos.')}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {list.map((s) => {
                const sel = picked.includes(s.id);
                const locked = !!s.blocked;
                return (
                  <button key={s.id} type="button" disabled={locked} onClick={() => toggle(s.id)}
                    aria-pressed={sel} title={[s.title, s.serviceName, ...s.tags].filter(Boolean).join(' · ')}
                    style={{ ...thumb, border: sel ? '3px solid #4f46e5' : '1px solid var(--line)', opacity: locked ? 0.55 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.title || kindLabel(s.kind, vi)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {locked ? <span style={badge('#b91c1c')}>{blockedLabel(s.blocked, vi)}</span>
                      : s.sent ? <span style={badge('rgba(15,23,42,.7)')}>{L(vi, 'ĐÃ GỬI', 'SENT')}</span>
                        : s.kind !== 'sample' ? <span style={badge('rgba(15,23,42,.7)')}>{kindLabel(s.kind, vi)}</span> : null}
                    {sel && <span aria-hidden style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>}
        {tab !== 'pay' && <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={disabled} onClick={() => { onUpload(); onClose(); }}
            style={{ flex: 1, minHeight: 42, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            {L(vi, 'Ảnh từ máy', 'From this device')}
          </button>
          <button type="button" disabled={busy || disabled || !picked.length} onClick={() => void send()}
            style={{ flex: 1.4, minHeight: 42, borderRadius: 12, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', opacity: busy || disabled || !picked.length ? 0.55 : 1 }}>
            {busy ? L(vi, 'Đang gửi…', 'Sending…') : picked.length ? L(vi, `Gửi ${picked.length} ảnh`, `Send ${picked.length}`) : L(vi, 'Chọn ảnh để gửi', 'Pick photos')}
          </button>
        </div>}
        {tab !== 'pay' && <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--c94a3b8)' }}>
          {L(vi, 'Mẹo: dán ảnh (Ctrl+V / ⌘+V) hoặc kéo thả ảnh vào ô trả lời.', 'Tip: paste (Ctrl+V / ⌘+V) or drag a photo onto the reply box.')}
          {typeof window !== 'undefined' && window.location.pathname.startsWith('/salon') && <>
            {' '}{L(vi, 'Bật/tắt AI tự gửi ảnh:', 'AI sending photos on/off:')}{' '}
            <a href="/salon/ai?tab=photos" style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{L(vi, 'Trợ lý AI › Ảnh gửi khách', 'AI assistant › Photos')}</a>
          </>}
        </div>}
      </div>
    </>
  );
}
