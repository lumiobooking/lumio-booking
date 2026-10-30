'use client';

// NGÀY NGHỈ — the pop-ups of the Staff page's time-off panel.
//
//  · TimeOffDialog: record new time off, or correct one (the technician, the
//    days, the hours, the reason). Saved = applied: the server refuses
//    bookings in it from that moment (booking page, bots, the desk, the
//    engine), and the pop-up says so — with how many bookings already sit
//    inside, and a link to that day on the Calendar.
//  · DecideDialog: approve / decline a technician's request, with a note.
//  · ConfirmDialog: "remove this day off?" before anything is deleted.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ind } from '../../../lib/ui-industry';
import { useIsMobile } from '../../../lib/responsive';
import { addMin, blockBody } from '../../../lib/cal-blocks';
import { addDaysKey, kindOf, spanSentence, type TimeOffSpan } from '../../../lib/time-off-ui';
import type { TimeOffRow } from './TimeOffPanel';

const AV = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
export function avatarBg(id: string | null): string {
  if (!id) return '#64748b';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}

export function Avatar({ id, name, size = 34 }: { id: string | null; name: string; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, background: avatarBg(id), color: '#fff' }}>
      {id ? (name.trim().charAt(0).toUpperCase() || '?') : '🔒'}
    </span>
  );
}

/** Centered on a computer, a bottom sheet on a phone. */
export function Modal({ title, sub, onClose, children, footer, width = 520 }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const isMobile = useIsMobile();
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', zIndex: 90 }} />
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{
          position: 'fixed', zIndex: 91, background: 'var(--c0f172a)', border: '1px solid var(--line)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
          ...(isMobile
            ? { left: 0, right: 0, bottom: 0, maxHeight: '92dvh', borderRadius: '22px 22px 0 0' }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 48px)', borderRadius: 18, boxShadow: '0 30px 60px -20px rgba(0,0,0,.45)' }),
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px 10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{title}</div>
            {sub && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 3 }}>{sub}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 18px 16px' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', paddingBottom: isMobile ? 'calc(14px + env(safe-area-inset-bottom, 0px))' : 14, borderTop: '1px solid var(--line)' }}>{footer}</div>}
      </div>
    </>
  );
}

export const btnPrimary: CSSProperties = { height: 42, padding: '0 18px', borderRadius: 11, border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
export const btnGhost: CSSProperties = { height: 42, padding: '0 16px', borderRadius: 11, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const pill = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 12px 0 5px', borderRadius: 999, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  border: `1.5px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--c818cf8)' : 'var(--ccbd5e1)',
});
const chip: CSSProperties = { height: 30, padding: '0 11px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'var(--c0b1322)', color: 'var(--ccbd5e1)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const field: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 42, padding: '0 11px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0b1322)', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 15 };
const lab: CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', marginBottom: 7, letterSpacing: '0.02em' };

/** What an approved day off does, in one breath. */
function Effects({ vi }: { vi: boolean }) {
  const L = (a: string, b: string) => ind(vi ? a : b);
  const items = [
    ['🚫', L('Không giao khách cho thợ trong giờ này', 'No bookings are given to the technician then')],
    ['🌐', L('Trang đặt lịch, bot chat và hotline AI không mở giờ này', 'The booking page, chat bot and AI hotline do not offer it')],
    ['🧾', L('Quầy cũng không đặt được — muốn đặt thì sửa hoặc bỏ ngày nghỉ', 'The desk cannot book it either — edit or remove the day off first')],
  ];
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(([i, t]) => <li key={t} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--ccbd5e1)' }}><span aria-hidden="true">{i}</span><span>{t}</span></li>)}
    </ul>
  );
}

/** The screen after saving: applied, and what is left for the desk to do. */
function Applied({ vi, title, inside, day, onClose }: { vi: boolean; title: string; inside: number; day: string; onClose: () => void }) {
  const L = (a: string, b: string) => ind(vi ? a : b);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 0 4px' }}>
      <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800 }}>✓</span>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Đã lưu và áp dụng', 'Saved and applied')}</div>
      <div style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{title}</div>
      <div style={{ width: '100%', textAlign: 'left', padding: 12, borderRadius: 12, background: 'var(--c0b1322)', border: '1px solid var(--line)' }}><Effects vi={vi} /></div>
      {inside > 0 && (
        <div role="status" style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left', padding: '10px 12px', borderRadius: 12, background: 'var(--wash-amber)', color: 'var(--ink-warn)', fontSize: 13.5, fontWeight: 600 }}>
          ⚠ {L(`Có ${inside} lịch hẹn đã đặt trước nằm trong giờ nghỉ. Lịch vẫn giữ — hãy dời sang thợ khác hoặc báo khách.`, `${inside} booking(s) made earlier sit inside this time off. They are kept — move them to another technician or tell the customers.`)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
        {inside > 0 && <a href={`/salon/calendar?day=${day}`} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{L('Mở Lịch ngày này', 'Open that day')}</a>}
        <button type="button" onClick={onClose} style={btnPrimary}>{L('Xong', 'Done')}</button>
      </div>
    </div>
  );
}

type Kind = 'hours' | 'day' | 'days';

/** Record or correct time off. */
export function TimeOffDialog({ vi, staff, today, row, onClose, onSaved }: {
  vi: boolean; staff: { id: string; name: string }[]; today: string;
  /** Present = editing this row. */
  row?: TimeOffRow | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { token } = useAuth();
  const L = (a: string, b: string) => ind(vi ? a : b);
  const editing = !!row;
  const [who, setWho] = useState<string>(row ? (row.staffId ?? 'ALL') : (staff[0]?.id ?? 'ALL'));
  const [kind, setKind] = useState<Kind>(row ? kindOf(row) : 'day');
  const [date, setDate] = useState(row?.startDate ?? today);
  const [endDate, setEndDate] = useState(row?.endDate ?? addDaysKey(today, 1));
  const [from, setFrom] = useState(row?.startTime ?? '13:00');
  const [to, setTo] = useState(row?.endTime ?? '17:00');
  const [reason, setReason] = useState(row?.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ inside: number } | null>(null);

  const span: TimeOffSpan = kind === 'hours'
    ? { startDate: date, endDate: date, startTime: from, endTime: to }
    : { startDate: date, endDate: kind === 'days' ? endDate : date, startTime: null, endTime: null };
  const whoName = who === 'ALL' ? L('Cả tiệm', 'The whole salon') : (staff.find((s) => s.id === who)?.name ?? row?.name ?? '');
  const sentence = `${whoName} ${who === 'ALL' ? L('khoá', 'closed') : L('nghỉ', 'off')} ${spanSentence(span, vi)}`;
  // A technician no longer active still shows when editing her row.
  const people = row?.staffId && !staff.some((s) => s.id === row.staffId) ? [...staff, { id: row.staffId, name: row.name }] : staff;

  async function save() {
    setErr(null);
    const r = blockBody({ who, kind, date, endDate, from, to, reason });
    if (!r.ok) {
      setErr(r.why === 'order' ? L('Giờ / ngày kết thúc phải sau lúc bắt đầu.', 'The end must be after the start.') : r.why === 'time' ? L('Chọn giờ bắt đầu và kết thúc.', 'Pick a start and an end time.') : L('Chọn ngày.', 'Pick a date.'));
      return;
    }
    // Editing: say explicitly "the whole salon" (null) or the technician; an empty reason clears it.
    const body = editing ? { ...r.body, staffId: who === 'ALL' ? null : who, reason: reason.trim() } : r.body;
    setBusy(true);
    try {
      const res = await apiFetch<{ bookingsInside?: number; status?: string }>(editing ? `/time-off/${encodeURIComponent(row!.id)}/edit` : '/time-off', { method: editing ? 'PATCH' : 'POST', token, body });
      setDone({ inside: res?.bookingsInside ?? 0 });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : L('Không lưu được.', 'Could not save.')); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Modal title={editing ? L('Đã sửa ngày nghỉ', 'Time off updated') : L('Đã ghi ngày nghỉ', 'Time off recorded')} onClose={onClose} width={460}>
        <Applied vi={vi} title={sentence} inside={done.inside} day={date} onClose={onClose} />
      </Modal>
    );
  }

  const kinds: { k: Kind; t: string; i: string }[] = [
    { k: 'day', t: L('Cả ngày', 'All day'), i: '☀️' },
    { k: 'days', t: L('Nhiều ngày', 'Several days'), i: '🗓' },
    { k: 'hours', t: L('Vài giờ', 'A few hours'), i: '⏱' },
  ];
  const pending = row?.status === 'PENDING';
  return (
    <Modal
      title={editing ? L('Sửa ngày nghỉ', 'Edit time off') : L('Ghi ngày nghỉ', 'Record time off')}
      sub={editing ? (pending ? L('Đơn đang chờ duyệt — sửa xong vẫn cần bấm Duyệt.', 'Still waiting — approve it after editing.') : L('Đã duyệt — lưu là áp dụng ngay giờ mới.', 'Approved — saving applies the new time at once.')) : L('Lưu là duyệt luôn và áp dụng ngay.', 'Saved as approved and applied at once.')}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={btnGhost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" onClick={save} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? L('Đang lưu…', 'Saving…') : editing ? L('Lưu thay đổi', 'Save changes') : L('Lưu & áp dụng', 'Save & apply')}</button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <span style={lab}>{L('AI NGHỈ?', 'WHO?')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {people.map((s) => (
              <button key={s.id} type="button" aria-pressed={who === s.id} onClick={() => setWho(s.id)} style={pill(who === s.id)}>
                <Avatar id={s.id} name={s.name} size={28} />{s.name}
              </button>
            ))}
            <button type="button" aria-pressed={who === 'ALL'} onClick={() => setWho('ALL')} style={pill(who === 'ALL')}>
              <Avatar id={null} name="" size={28} />{L('Cả tiệm', 'Whole salon')}
            </button>
          </div>
        </div>

        <div>
          <span style={lab}>{L('NGHỈ BAO LÂU?', 'HOW LONG?')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {kinds.map((x) => (
              <button key={x.k} type="button" aria-pressed={kind === x.k} onClick={() => setKind(x.k)}
                style={{ height: 58, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                  border: `1.5px solid ${kind === x.k ? '#6366f1' : 'var(--c334155)'}`, background: kind === x.k ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: kind === x.k ? 'var(--c818cf8)' : 'var(--ccbd5e1)', fontSize: 13.5, fontWeight: 700 }}>
                <span aria-hidden="true" style={{ fontSize: 18 }}>{x.i}</span>{x.t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: kind === 'hours' ? '1.3fr 1fr 1fr' : kind === 'days' ? '1fr 1fr' : '1fr', gap: 10 }}>
          <label><span style={lab}>{kind === 'days' ? L('TỪ NGÀY', 'FROM') : L('NGÀY', 'DATE')}</span>
            <input type="date" value={date} onChange={(e) => { const v = e.target.value; setDate(v); if (endDate < v) setEndDate(v); }} style={field} />
          </label>
          {kind === 'days' && (
            <label><span style={lab}>{L('ĐẾN HẾT NGÀY', 'UNTIL (INCL.)')}</span>
              <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} style={field} />
            </label>
          )}
          {kind === 'hours' && (<>
            <label><span style={lab}>{L('TỪ', 'FROM')}</span><input type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} style={field} /></label>
            <label><span style={lab}>{L('ĐẾN', 'TO')}</span><input type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} style={field} /></label>
          </>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -6 }}>
          {kind !== 'hours' && <>
            <button type="button" style={chip} onClick={() => { setDate(today); if (endDate < today) setEndDate(today); }}>{L('Hôm nay', 'Today')}</button>
            <button type="button" style={chip} onClick={() => { const t = addDaysKey(today, 1); setDate(t); if (endDate < t) setEndDate(t); }}>{L('Ngày mai', 'Tomorrow')}</button>
            {kind === 'days' && [3, 7].map((n) => <button key={n} type="button" style={chip} onClick={() => setEndDate(addDaysKey(date, n - 1))}>{L(`${n} ngày`, `${n} days`)}</button>)}
          </>}
          {kind === 'hours' && <>
            <button type="button" style={chip} onClick={() => { setFrom('09:00'); setTo('12:00'); }}>{L('Buổi sáng', 'Morning')}</button>
            <button type="button" style={chip} onClick={() => { setFrom('13:00'); setTo('17:00'); }}>{L('Buổi chiều', 'Afternoon')}</button>
            {[1, 2, 3].map((h) => <button key={h} type="button" style={chip} onClick={() => setTo(addMin(from, h * 60))}>+{h} {L('giờ', 'h')}</button>)}
          </>}
        </div>

        <div>
          <span style={lab}>{L('LÝ DO (KHÔNG BẮT BUỘC)', 'REASON (OPTIONAL)')}</span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={L('VD: ốm, về quê', 'e.g. sick, family trip')} style={field} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {(vi ? ['Ốm', 'Việc gia đình', 'Về quê', 'Đào tạo', 'Nghỉ phép năm'] : ['Sick', 'Family', 'Trip', 'Training', 'Annual leave']).map((x) => (
              <button key={x} type="button" style={{ ...chip, ...(reason === x ? { borderColor: '#6366f1', color: 'var(--c818cf8)' } : {}) }} onClick={() => setReason(x)}>{x}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 14, border: '1px solid var(--c3730a3)', background: 'var(--c1e1b4b)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar id={who === 'ALL' ? null : who} name={whoName} size={34} />
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{sentence}</div>
          </div>
          {!pending && <Effects vi={vi} />}
        </div>
        {err && <div role="alert" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

/** Approve or decline a technician's request. */
export function DecideDialog({ vi, row, today, decision, onClose, onSaved }: {
  vi: boolean; row: TimeOffRow; today: string; decision: 'APPROVED' | 'DENIED'; onClose: () => void; onSaved: () => void;
}) {
  const { token } = useAuth();
  const L = (a: string, b: string) => ind(vi ? a : b);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ inside: number } | null>(null);
  const approve = decision === 'APPROVED';
  const sentence = `${row.name} ${L('nghỉ', 'off')} ${spanSentence(row, vi)}`;
  void today;

  async function go() {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch<{ bookingsInside?: number }>(`/time-off/${encodeURIComponent(row.id)}`, { method: 'PATCH', token, body: { decision, note: note.trim() || undefined } });
      onSaved();
      if (approve) setDone({ inside: res?.bookingsInside ?? 0 }); else onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : L('Không lưu được.', 'Could not save.')); } finally { setBusy(false); }
  }

  if (done) {
    return <Modal title={L('Đã duyệt', 'Approved')} onClose={onClose} width={460}><Applied vi={vi} title={sentence} inside={done.inside} day={row.startDate} onClose={onClose} /></Modal>;
  }
  return (
    <Modal title={approve ? L('Duyệt ngày nghỉ?', 'Approve this time off?') : L('Từ chối đơn nghỉ?', 'Decline this request?')} onClose={onClose} width={460}
      footer={<>
        <button type="button" onClick={onClose} style={btnGhost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" onClick={go} disabled={busy} style={{ ...btnPrimary, ...(approve ? { background: '#15803d', borderColor: '#15803d' } : { background: '#dc2626', borderColor: '#dc2626' }), opacity: busy ? 0.6 : 1 }}>
          {busy ? L('Đang lưu…', 'Saving…') : approve ? L('Duyệt & áp dụng', 'Approve & apply') : L('Từ chối', 'Decline')}
        </button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, background: 'var(--c0b1322)', border: '1px solid var(--line)' }}>
          <Avatar id={row.staffId} name={row.name} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{sentence}</div>
            {row.reason && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 2 }}>“{row.reason}”</div>}
          </div>
        </div>
        {approve && <Effects vi={vi} />}
        <label><span style={lab}>{L('GHI CHÚ CHO THỢ (KHÔNG BẮT BUỘC)', 'NOTE TO THE TECHNICIAN (OPTIONAL)')}</span>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={approve ? L('VD: nhớ bàn giao khách quen', 'e.g. hand over your regulars') : L('VD: hôm đó tiệm đông, đổi ngày khác nhé', 'e.g. busy day, could you pick another?')} style={field} />
        </label>
        {err && <div role="alert" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

/** "Remove this?" — nothing is deleted without it. */
export function ConfirmDialog({ vi, title, text, danger, onClose, onConfirm }: { vi: boolean; title: string; text: ReactNode; danger: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const L = (a: string, b: string) => ind(vi ? a : b);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose} width={420}
      footer={<>
        <button type="button" onClick={onClose} style={btnGhost}>{L('Không', 'Keep')}</button>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await onConfirm(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); } }}
          style={{ ...btnPrimary, background: '#dc2626', borderColor: '#dc2626', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : danger}</button>
      </>}>
      <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>{text}</div>
      {err && <div role="alert" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
    </Modal>
  );
}
