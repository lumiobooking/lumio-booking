'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatPrice } from '../../../lib/money';
import { fmtInTz } from '../../../lib/datetime';
import { C, cardStyle, lblStyle, Lx, Pill, Chip, Btn, Seg, Avatar, Empty, reasonText, whenText, clockText, ordinal } from './fb-ui';
import type { CaseHead } from './FeedbackOverview';

type Bucket = 'open' | 'contacted' | 'resolved' | 'all';
interface CaseDetail {
  id: string; status: string; dueAt: string; overdue: boolean; createdAt: string;
  assigneeName: string | null; firstResponseAt: string | null; resolvedAt: string | null; resolution: string | null; note: string | null; wonBack: boolean | null;
  customer: { name: string; phone: string | null; wantsContact: boolean; visits: number; spentCents: number; nextVisit: string | null };
  staffName: string | null; staffId: string | null; service: string | null; visitAt: string; source: string | null;
  feedback: { reasons: string[]; comment: string | null; photoUrl: string | null };
  suggestion: { advice: string; message: string };
  events: { id: string; kind: string; byName: string | null; text: string | null; createdAt: string }[];
}

export function FeedbackCases({ token, lang, staffId, search, selectedId, onSelect, onChanged }: {
  token: string; lang: string; staffId: string; search: string;
  selectedId: string | null; onSelect: (id: string | null) => void; onChanged: () => void;
}) {
  const L = Lx(lang);
  const [bucket, setBucket] = useState<Bucket>('open');
  const [list, setList] = useState<CaseHead[] | null>(null);
  const [counts, setCounts] = useState({ open: 0, contacted: 0, resolved: 0, all: 0 });
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [now, setNow] = useState(Date.now());
  const detailRef = useRef<HTMLDivElement>(null);
  const tapped = useRef(false);

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams({ status: bucket });
    if (staffId) qs.set('staffId', staffId);
    if (search.trim()) qs.set('q', search.trim());
    try {
      const d = await apiFetch<{ cases: CaseHead[]; counts: typeof counts }>(`/feedback/cases?${qs}`, { token });
      setList(d.cases); setCounts(d.counts); setErr('');
    } catch (e) { setErr((e as Error).message); setList([]); }
  }, [bucket, staffId, search, token]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  // A deep link (?case=…) opens straight onto that case; otherwise the first in the list.
  useEffect(() => {
    if (!list) return;
    if (!selectedId && list.length) onSelect(list[0].id);
  }, [list, selectedId, onSelect]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let alive = true;
    apiFetch<CaseDetail>(`/feedback/cases/${encodeURIComponent(selectedId)}`, { token })
      .then((d) => {
        if (!alive) return;
        setDetail(d); setMsg(d.suggestion?.message ?? ''); setNote(d.note ?? '');
        // On a phone the case opens BELOW the list: take the owner to it.
        if (tapped.current && typeof window !== 'undefined' && window.innerWidth < 980) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        tapped.current = false;
      })
      .catch((e) => { if (alive) { setDetail(null); setErr((e as Error).message); } });
    return () => { alive = false; };
  }, [selectedId, token]);

  async function act(action: string, extra: { text?: string; resolution?: string } = {}) {
    if (!detail || busy) return;
    setBusy(action); setErr('');
    try {
      const d = await apiFetch<CaseDetail>(`/feedback/cases/${encodeURIComponent(detail.id)}`, { method: 'POST', token, body: { action, ...extra } });
      setDetail(d); setNote(d.note ?? note);
      await loadList(); onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }

  const first = detail ? detail.customer.name.split(' ')[0] : '';
  const statusIdx = detail ? ({ NEW: 0, IN_PROGRESS: 1, CONTACTED: 2, RESOLVED: 3 } as Record<string, number>)[detail.status] ?? 0 : 0;
  const sourceText = (s: string | null) => s === 'ipad' ? L('trả lời trên iPad của tiệm', 'answered on the salon iPad') : s === 'sms' ? L('trả lời qua link SMS', 'answered from the text link') : s === 'qr' ? L('quét mã QR trên hoá đơn', 'scanned the receipt QR') : L('trả lời qua link', 'answered from the link');
  const eventText = (e: CaseDetail['events'][number]) => {
    const by = e.byName ? <b style={{ color: C.ink }}>{e.byName}</b> : null;
    switch (e.kind) {
      case 'received': return <>{e.text === 'Answered on the salon iPad' ? L('Nhận trên iPad của tiệm', 'Received on the salon iPad') : e.text === 'Answered from the text link' ? L('Nhận qua link SMS', 'Received from the text link') : L('Nhận qua link', 'Received from the link')} · {L('đã báo chủ tiệm', 'owner alerted')}</>;
      case 'taken': return <>{by} {L('nhận xử lý', 'took the case')}</>;
      case 'text_sent': return <>{by} {L('đã nhắn tin', 'sent a text')}{e.text ? <span style={{ color: C.muted }}> — “{e.text.length > 70 ? `${e.text.slice(0, 70)}…` : e.text}”</span> : null}</>;
      case 'call': return <>{by} {L('đã gọi', 'called')}</>;
      case 'free_fix': return <>{by} {L('hẹn sửa miễn phí', 'offered a free fix')}</>;
      case 'discount': return <>{by} {L('tặng giảm giá lần sau', 'offered a discount next visit')}</>;
      case 'refund': return <>{by} {L('hoàn tiền', 'refunded')}</>;
      case 'note': return <>{by} {L('ghi chú nội bộ', 'added an internal note')}</>;
      case 'photo': return <>📷 {L('Khách gửi thêm ảnh', 'The customer added a photo')}</>;
      case 'resolved': return <>{by} {L('đã giải quyết', 'resolved the case')}</>;
      case 'status': return <>{by} {e.text === '→ CONTACTED' ? L('đánh dấu đã liên hệ', 'marked contacted') : e.text === '→ IN_PROGRESS' ? L('mở lại ca', 'reopened the case') : L('đổi trạng thái', 'changed the status')}</>;
      default: return <>{by} {e.text}</>;
    }
  };

  const clockPill = (c: { status: string; dueAt: string; wantsContact?: boolean }) => {
    if (c.status === 'RESOLVED') return <Pill tone="good">✓ {L('Đã xong', 'Resolved')}</Pill>;
    if (c.status === 'CONTACTED') return <Pill tone="acc">{L('Đã liên hệ', 'Contacted')}</Pill>;
    const ck = clockText(c.dueAt, lang, now);
    return ck.overdue ? <Pill tone="bad">⚠ {ck.text}</Pill> : <Pill tone={c.wantsContact ? 'warn' : 'mut'}>⏱ {ck.text}</Pill>;
  };

  return (
    <div className="fb-split" style={{ flex: 1 }}>
      <div style={{ ...cardStyle, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 520 }}>
        <div style={{ display: 'flex', padding: 12, borderBottom: `1px solid ${C.line}` }}>
          <Seg<Bucket> style={{ flex: 1 }} value={bucket} onChange={(b) => { if (b === bucket) return; setList(null); setBucket(b); onSelect(null); }} options={[
            { key: 'open', label: `${L('Mở', 'Open')} · ${counts.open}` },
            { key: 'contacted', label: `${L('Đã liên hệ', 'Contacted')} · ${counts.contacted}` },
            { key: 'resolved', label: `${L('Xong', 'Resolved')} · ${counts.resolved}` },
            { key: 'all', label: L('Tất cả', 'All') },
          ]} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: 640 }}>
          {list === null && <Empty>{L('Đang tải…', 'Loading…')}</Empty>}
          {list && list.length === 0 && <Empty>{bucket === 'open' ? `✓ ${L('Không còn ca nào đang mở.', 'No open cases. Nice.')}` : L('Không có ca nào.', 'No cases here.')}</Empty>}
          {list?.map((c) => {
            const on = c.id === selectedId;
            return (
              <div key={c.id} className="fb-row" onClick={() => { tapped.current = true; onSelect(c.id); }}
                style={{ display: 'flex', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${C.line}`, background: on ? C.accSoft : undefined, boxShadow: on ? `inset 3px 0 0 ${C.acc}` : undefined }}>
                <Avatar name={c.customerName} size={38} seed={c.id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <b style={{ color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.customerName}</b>
                    {clockPill(c)}
                  </div>
                  <div style={{ fontSize: 13, color: C.muted, margin: '3px 0 8px' }}>
                    {[c.service, c.staffName, whenText(c.visitAt, lang)].filter(Boolean).join(' · ')}{!c.wantsContact ? L(' · không cần gọi', ' · no call wanted') : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.reasons.map((r) => <Chip key={r} bad>{reasonText(r, lang)}</Chip>)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>
          {L('Chủ tiệm & quản lý nhận thông báo điện thoại ngay khi có ca mới.', 'Owner & managers get a phone alert the moment a case opens.')}
        </div>
      </div>

      <div ref={detailRef} style={{ ...cardStyle, padding: 'clamp(16px, 3vw, 22px) clamp(14px, 3vw, 24px)', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 520, scrollMarginTop: 80 }}>
        {!detail && <Empty>{list && list.length === 0 ? L('Chọn một ca bên trái khi có.', 'Pick a case on the left when there is one.') : L('Đang tải…', 'Loading…')}</Empty>}
        {detail && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0, flex: '1 1 260px' }}>
                <Avatar name={detail.customer.name} size={52} seed={detail.id} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, color: C.ink }}>{detail.customer.name}</div>
                  <div style={{ color: C.muted, fontSize: 13.5, marginTop: 3, lineHeight: 1.45 }}>
                    {[
                      detail.customer.phone,
                      detail.customer.wantsContact ? <b key="w" style={{ color: C.ink2 }}>{L('muốn được gọi lại', 'wants a call back')}</b> : L('không cần gọi lại', 'no call wanted'),
                      detail.customer.visits ? L(`lần ghé thứ ${detail.customer.visits}`, `${ordinal(detail.customer.visits, lang)} visit`) : null,
                      detail.customer.spentCents ? L(`đã chi ${formatPrice(detail.customer.spentCents)}`, `${formatPrice(detail.customer.spentCents)} spent`) : null,
                      detail.customer.nextVisit ? L(`hẹn tới ${fmtInTz(detail.customer.nextVisit, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, `next visit ${fmtInTz(detail.customer.nextVisit, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`) : null,
                    ].filter(Boolean).map((p, i) => <span key={i}>{i ? ' · ' : ''}{p}</span>)}
                  </div>
                </div>
              </div>
              {detail.status === 'RESOLVED' ? <Pill tone="good" style={{ fontSize: 13, padding: '6px 12px' }}>✓ {L('Đã giải quyết', 'Resolved')}{detail.resolution ? ` · ${detail.resolution}` : ''}</Pill>
                : detail.status === 'CONTACTED' ? <Pill tone="acc" style={{ fontSize: 13, padding: '6px 12px' }}>{L('Đã liên hệ', 'Contacted')}</Pill>
                : detail.overdue ? <Pill tone="bad" style={{ fontSize: 13, padding: '6px 12px' }}>⚠ {clockText(detail.dueAt, lang, now).text}</Pill>
                : <Pill tone="warn" style={{ fontSize: 13, padding: '6px 12px' }}>⏱ {L('Trả lời trước', 'Reply by')} {whenText(detail.dueAt, lang)}</Pill>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
              {[L('Mới', 'New'), `${L('Đang xử lý', 'In progress')}${detail.assigneeName ? ` · ${detail.assigneeName}` : ''}`, L('Đã liên hệ', 'Contacted'), L('Đã xong', 'Resolved')].map((label, i) => {
                const done = i < statusIdx || (i === 3 && statusIdx === 3);
                const nowStep = i === statusIdx && statusIdx !== 3;
                return (
                  <div key={i} style={{ display: 'contents' }}>
                    {i > 0 && <span style={{ height: 2, flex: 1, minWidth: 16, background: i <= statusIdx ? C.acc : C.line }} />}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: nowStep ? C.accInk : done ? C.ink2 : C.faint }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, border: `1.5px solid ${done ? C.acc : nowStep ? C.acc : C.line}`, background: done ? C.acc : C.card, color: done ? '#fff' : nowStep ? C.accInk : C.faint, boxShadow: nowStep ? `0 0 0 4px ${C.accSoft}` : 'none' }}>{done ? '✓' : i + 1}</span>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="fb-half">
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
                <div style={{ ...lblStyle, marginBottom: 10 }}>{L('Khách nói gì', 'What they said')}</div>
                {detail.feedback.reasons.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>{detail.feedback.reasons.map((r) => <Chip key={r} bad>{reasonText(r, lang)}</Chip>)}</div>}
                {detail.feedback.comment ? <div style={{ fontSize: 15, lineHeight: 1.5, color: C.ink }}>“{detail.feedback.comment}”</div>
                  : <div style={{ fontSize: 13.5, color: C.muted }}>{L('Khách không viết thêm.', 'No comment written.')}</div>}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                  {detail.feedback.photoUrl && (
                    <a href={detail.feedback.photoUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={detail.feedback.photoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
                    </a>
                  )}
                  <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
                    {detail.feedback.photoUrl ? L('1 ảnh · ', '1 photo · ') : ''}{detail.service ?? L('Dịch vụ', 'Visit')}{detail.staffName ? <> {L('với', 'with')} <b style={{ color: C.ink2 }}>{detail.staffName}</b></> : null}<br />
                    {fmtInTz(detail.visitAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {sourceText(detail.source)}
                  </div>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.accLine}`, borderRadius: 14, padding: 16, background: C.accSoft }}>
                <div style={{ ...lblStyle, color: C.accInk, marginBottom: 10 }}>✦ {L('Gợi ý cách xử lý', 'Suggested fix')}</div>
                <div style={{ fontSize: 14, lineHeight: 1.55, color: C.ink2 }}>{detail.suggestion.advice}</div>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} aria-label={L('Tin nhắn gửi khách', 'Message to the customer')}
                  style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, background: C.card, border: `1px solid ${C.line}`, fontSize: 13.5, lineHeight: 1.5, color: C.ink2, fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
            </div>

            <div>
              <div style={{ ...lblStyle, marginBottom: 10 }}>{L('Xử lý cho khách', 'Make it right')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn primary disabled={!detail.customer.phone || !msg.trim() || !!busy} onClick={() => act('send_text', { text: msg })} title={!detail.customer.phone ? L('Không có số điện thoại', 'No mobile on file') : undefined}>💬 {busy === 'send_text' ? L('Đang gửi…', 'Sending…') : L('Gửi tin này', 'Send this text')}</Btn>
                {detail.customer.phone && <Btn href={`tel:${detail.customer.phone}`} onClick={() => void act('call')}>📞 {L('Gọi', 'Call')}</Btn>}
                <Btn disabled={!!busy} onClick={() => act('free_fix')}>💅 {L('Hẹn sửa miễn phí', 'Book a free fix')}</Btn>
                <Btn disabled={!!busy} onClick={() => act('discount')}>🏷 {L('Giảm giá lần sau', 'Discount next visit')}</Btn>
                <Btn disabled={!!busy} onClick={() => act('refund')}>↩ {L('Hoàn tiền', 'Refund')}</Btn>
              </div>
              {err && <div style={{ marginTop: 8, fontSize: 13, color: C.bad }}>{err}</div>}
            </div>

            <div className="fb-half">
              <div>
                <div style={{ ...lblStyle, marginBottom: 6 }}>{L('Diễn biến', 'Timeline')}</div>
                {detail.events.map((e) => (
                  <div key={e.id} style={{ display: 'flex', gap: 12, fontSize: 13.5, padding: '7px 0', color: C.ink2 }}>
                    <span style={{ width: 64, color: C.faint, flexShrink: 0 }}>{fmtInTz(e.createdAt, { hour: 'numeric', minute: '2-digit' })}</span>
                    <span>{eventText(e)}</span>
                  </div>
                ))}
                {(detail.status === 'NEW' || detail.status === 'IN_PROGRESS') && (
                  <div style={{ display: 'flex', gap: 12, fontSize: 13.5, padding: '7px 0', alignItems: 'center' }}>
                    <span style={{ width: 64, color: C.faint, flexShrink: 0 }}>—</span>
                    <span style={{ color: C.faint }}>{L(`Tiếp theo: liên hệ ${first}`, `Next: contact ${first}`)}</span>
                    {detail.status === 'NEW' && <Btn small disabled={!!busy} onClick={() => act('take')} style={{ marginLeft: 'auto' }}>{L('Tôi nhận ca này', 'I’ll take it')}</Btn>}
                  </div>
                )}
              </div>
              <div>
                <div style={{ ...lblStyle, marginBottom: 8 }}>{L('Ghi chú nội bộ', 'Internal note')}</div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note.trim() && note.trim() !== (detail.note ?? '').trim()) void act('note', { text: note }); }}
                  placeholder={L('Chỉ chủ tiệm & quản lý thấy…', 'Only owners and managers see this…')} rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px', fontSize: 13.5, color: C.ink2, minHeight: 64, background: C.card, fontFamily: 'inherit', resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
                  {detail.status === 'RESOLVED' ? (
                    <Btn disabled={!!busy} onClick={() => act('reopen')}>{L('Mở lại', 'Reopen')}</Btn>
                  ) : (
                    <>
                      {detail.status !== 'CONTACTED' && <Btn disabled={!!busy} onClick={() => act('contacted')}>{L('Đã liên hệ', 'Mark contacted')}</Btn>}
                      <Btn disabled={!!busy} onClick={() => act('resolve')} style={{ borderColor: 'var(--c166534)', color: C.good }}>✓ {L('Đã giải quyết', 'Resolve')}</Btn>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
