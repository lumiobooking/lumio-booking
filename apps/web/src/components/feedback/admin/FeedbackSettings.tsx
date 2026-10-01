'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { C, cardStyle, Lx, Pill, Toggle, Avatar, reasonText } from './fb-ui';

export interface FbSettings {
  enabled: boolean; askOnDisplay: boolean; smsFallback: boolean; emailFallback?: boolean; smsDelayMinutes: number; receiptQr: boolean; cooldownDays: number;
  reasons: string[]; askPhoto: boolean; replyHours: number; alertPush: boolean; alertUserIds: string[];
  techSeeOwnScore: boolean; techSeeReasons: boolean; techLeaderboard: boolean; alertSameReason: number; alertWindowDays: number;
}
export interface SettingsView { settings: FbSettings; people: { id: string; name: string; role: string }[]; googleConnected: boolean }

const optBox = { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', border: `1px solid ${C.line}`, borderRadius: 12 } as const;
const selStyle = { height: 36, padding: '0 10px', border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: C.card, color: C.ink, fontFamily: 'inherit', maxWidth: '100%' } as const;
const secStyle = { ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 } as const;
const h3 = { margin: 0, fontSize: 16, fontWeight: 700, color: C.ink } as const;

function Opt({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ ...optBox, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <b style={{ color: C.ink, fontSize: 14 }}>{title}</b>
        {sub && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function FeedbackSettings({ view, draft, setDraft, lang, readOnly }: {
  view: SettingsView; draft: FbSettings; setDraft: (s: FbSettings) => void; lang: string; readOnly: boolean;
}) {
  const L = Lx(lang);
  const [adding, setAdding] = useState(false);
  const [newReason, setNewReason] = useState('');
  const set = <K extends keyof FbSettings>(k: K, v: FbSettings[K]) => setDraft({ ...draft, [k]: v });
  const s = draft;

  const alertOn = (id: string) => s.alertPush && (s.alertUserIds.length === 0 || s.alertUserIds.includes(id));
  const toggleAlert = (id: string, on: boolean) => {
    const everyone = view.people.map((p) => p.id);
    const current = s.alertUserIds.length ? s.alertUserIds : everyone;
    let next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    if (next.length === everyone.length && everyone.every((x) => next.includes(x))) next = [];
    // Nobody left to tell means phone alerts are off, not "tell everyone".
    if (!on && next.length === 0) { setDraft({ ...s, alertPush: false, alertUserIds: [] }); return; }
    setDraft({ ...s, alertPush: true, alertUserIds: next });
  };

  const addReason = () => {
    const r = newReason.trim().slice(0, 40);
    if (r && !s.reasons.includes(r) && s.reasons.length < 12) set('reasons', [...s.reasons, r]);
    setNewReason(''); setAdding(false);
  };

  const step = (text: ReactNode, on = false, off = false) => (
    <span style={{ padding: '8px 12px', borderRadius: 10, fontWeight: 600, background: on ? C.accSoft : C.track, color: on ? C.accInk : C.ink2, opacity: off ? 0.45 : 1, textDecoration: off ? 'line-through' : 'none' }}>{text}</span>
  );

  const combos: [number, number][] = [[2, 7], [2, 14], [3, 14], [3, 30], [4, 30], [5, 30]];
  if (!combos.some(([n, d]) => n === s.alertSameReason && d === s.alertWindowDays)) combos.push([s.alertSameReason, s.alertWindowDays]);

  return (
    <fieldset disabled={readOnly} style={{ border: 'none', margin: 0, padding: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={secStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={h3}>{L('Cách hoạt động', 'How it works')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {s.enabled ? <Pill tone="good">● {L('Đang bật', 'On')}</Pill> : <Pill tone="mut">{L('Đang tắt', 'Off')}</Pill>}
            <Toggle on={s.enabled} onChange={(v) => set('enabled', v)} label={L('Bật hỏi ý kiến khách', 'Ask customers for feedback')} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.ink2, flexWrap: 'wrap' }}>
          {step(L('Khách thanh toán', 'Customer pays'))}→
          {step(L('Hỏi trên iPad khách', 'Asked on the customer iPad'), s.askOnDisplay, !s.askOnDisplay)}→
          {step(<>{L('Không trả lời?', 'No answer?')} {[s.smsFallback ? 'SMS' : null, s.emailFallback !== false ? 'email' : null].filter(Boolean).join(' + ') || L('không nhắc', 'no follow-up')} {s.smsDelayMinutes <= 2 ? <b>{L('ngay sau khi trả tiền', 'right after paying')}</b> : <>{L('sau', 'after')} <b>{s.smsDelayMinutes} {L('phút', 'min')}</b></>}</>, false, !s.smsFallback && s.emailFallback === false)}→
          {step(`😊 → ${L('QR / link Google', 'Google QR / link')}`)}
          {step(`😕 → ${L('góp ý riêng → ca cho anh/chị', 'private note → case for you')}`)}
        </div>
        {!view.googleConnected && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: C.warnBg, color: C.warn, fontSize: 13, fontWeight: 600 }}>
            ⚠ {L('Tiệm chưa có link đánh giá Google — khách hài lòng sẽ chưa được mời lên Google.', 'No Google review link yet — happy customers can’t be sent to Google.')} <Link href="/salon/reviews" style={{ color: 'inherit' }}>{L('Cài đặt link', 'Set it up')}</Link>
          </div>
        )}
        {!s.enabled && (
          <div style={{ fontSize: 13, color: C.muted }}>{L('Đang tắt: quầy thu ngân không hỏi khách và không gửi SMS. Bật lên rồi bấm “Lưu thay đổi”.', 'Off: the till doesn’t ask and no texts go out. Switch it on, then “Save changes”.')}</div>
        )}
      </div>

      <div className="fb-half">
        <div style={secStyle}>
          <h3 style={h3}>{L('Khi nào hỏi', 'When to ask')}</h3>
          <Opt title={L('Trên iPad khách sau khi thanh toán', 'On the customer iPad after payment')} sub={L('Ngay sau màn hình tip. Cần ghép màn hình khách.', 'Right after the tip screen. Needs the customer display paired.')}>
            <Toggle on={s.askOnDisplay} onChange={(v) => set('askOnDisplay', v)} />
          </Opt>
          <Opt title={L('Nhắn SMS nếu khách chưa trả lời', 'Text message if they didn’t answer')} sub={L('Chỉ gửi cho khách đồng ý nhận tin.', 'Only to customers who agreed to texts.')}>
            <select value={s.smsDelayMinutes} onChange={(e) => set('smsDelayMinutes', Number(e.target.value))} style={selStyle} disabled={(!s.smsFallback && s.emailFallback === false) || readOnly}>
              {[...new Set([1, 15, 30, 45, 60, 90, 120, 180, 240, s.smsDelayMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{m <= 2 ? L('Ngay sau khi trả tiền', 'Right after paying') : m < 60 || m % 60 ? L(`${m} phút sau khi trả tiền`, `${m} min after paying`) : L(`${m / 60} giờ sau khi trả tiền`, `${m / 60} h after paying`)}</option>
              ))}
            </select>
            <Toggle on={s.smsFallback} onChange={(v) => set('smsFallback', v)} />
          </Opt>
          <Opt title={L('Gửi email nếu khách chưa trả lời', 'Email if they didn’t answer')} sub={L(`Cùng lúc với SMS (${s.smsDelayMinutes} phút sau khi trả tiền), cho khách có email. Email có sẵn 2 nút Hài lòng / Chưa hài lòng.`, `Same time as the text (${s.smsDelayMinutes} min after paying), to customers with an email. The email carries the two buttons.`)}>
            <Toggle on={s.emailFallback !== false} onChange={(v) => set('emailFallback', v)} />
          </Opt>
          <Opt title={L('Mã QR trên hoá đơn', 'QR code on the receipt')} sub={L('Mở cùng trang 2 nút trên điện thoại khách.', 'Opens the same two-button page on their phone.')}>
            <Toggle on={s.receiptQr} onChange={(v) => set('receiptQr', v)} />
          </Opt>
          <Opt title={L('Không hỏi lại cùng một khách trong', 'Don’t ask the same customer again for')}>
            <select value={s.cooldownDays} onChange={(e) => set('cooldownDays', Number(e.target.value))} style={selStyle}>
              {[...new Set([0, 14, 30, 45, 60, 90, s.cooldownDays])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>{d === 0 ? L('Lần nào cũng hỏi', 'Ask every visit') : L(`${d} ngày`, `${d} days`)}</option>
              ))}
            </select>
          </Opt>
        </div>

        <div style={secStyle}>
          <h3 style={h3}>{L('Lý do “chưa hài lòng” khách được chọn', '“Not quite” reasons customers can pick')}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {s.reasons.map((r) => (
              <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 600, background: C.card, color: C.ink }}>
                {reasonText(r, lang)}
                {!readOnly && s.reasons.length > 1 && (
                  <button type="button" className="fb-btn" aria-label={L('Bỏ', 'Remove')} onClick={() => set('reasons', s.reasons.filter((x) => x !== r))}
                    style={{ background: 'none', border: 'none', padding: 0, color: C.faint, fontSize: 13 }}>✕</button>
                )}
              </span>
            ))}
            {!readOnly && s.reasons.length < 12 && (adding ? (
              <input autoFocus value={newReason} onChange={(e) => setNewReason(e.target.value)} maxLength={40}
                onKeyDown={(e) => { if (e.key === 'Enter') addReason(); if (e.key === 'Escape') { setAdding(false); setNewReason(''); } }} onBlur={addReason}
                placeholder={L('Lý do mới…', 'New reason…')}
                style={{ height: 34, padding: '0 12px', borderRadius: 999, border: `1px dashed ${C.acc2}`, fontSize: 13, background: C.card, color: C.ink, width: 170, fontFamily: 'inherit' }} />
            ) : (
              <button type="button" className="fb-btn" onClick={() => setAdding(true)}
                style={{ padding: '7px 12px', borderRadius: 999, border: `1px dashed ${C.acc2}`, fontSize: 13, fontWeight: 600, background: C.card, color: C.accInk }}>+ {L('Thêm lý do', 'Add a reason')}</button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{L('Khách thấy bằng ngôn ngữ của mình (tiếng Anh cho tiệm ở Mỹ, tiếng Việt ở Việt Nam).', 'Customers see these in their own language (English for US salons, Vietnamese in Vietnam).')}</div>
          <Opt title={L('Xin ảnh', 'Ask for a photo')} sub={L('Không bắt buộc với khách.', 'Optional for the customer.')}>
            <Toggle on={s.askPhoto} onChange={(v) => set('askPhoto', v)} />
          </Opt>
        </div>

        <div style={secStyle}>
          <h3 style={h3}>{L('Ai được báo khi khách “chưa hài lòng”', 'Who hears about a “not quite”')}</h3>
          {view.people.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>{L('Chưa có tài khoản chủ tiệm / quản lý.', 'No owner or manager accounts yet.')}</div>}
          {view.people.map((p) => (
            <div key={p.id} style={optBox}>
              <Avatar name={p.name} size={30} seed={p.id} initials={p.name.trim()[0]?.toUpperCase()} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ color: C.ink, fontSize: 14 }}>{p.name} ({p.role === 'Owner' ? L('Chủ tiệm', 'Owner') : L('Quản lý', 'Manager')})</b>
                <div style={{ fontSize: 12.5, color: C.muted }}>{L('Thông báo điện thoại', 'Phone alert')}</div>
              </div>
              <Toggle on={alertOn(p.id)} onChange={(v) => toggleAlert(p.id, v)} />
            </div>
          ))}
          <Opt title={L('Cam kết phản hồi', 'Reply promise')} sub={L('Hiện cho khách và đếm ngược trên từng ca.', 'Shown to the customer and counted down on each case.')}>
            <select value={s.replyHours} onChange={(e) => set('replyHours', Number(e.target.value))} style={selStyle}>
              {[...new Set([4, 12, 24, 48, 72, s.replyHours])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{L(`${h} giờ`, `${h} hours`)}</option>)}
            </select>
          </Opt>
        </div>

        <div style={secStyle}>
          <h3 style={h3}>{L('Thợ được xem gì', 'What technicians see')}</h3>
          <Opt title={L('Điểm hài lòng & số lượt Google của chính mình', 'Their own happy score and Google count')} sub={L('Trong app nhân viên — tạo động lực mà không nêu tên khách.', 'In the staff app — motivates without naming customers.')}>
            <Toggle on={s.techSeeOwnScore} onChange={(v) => set('techSeeOwnScore', v)} />
          </Opt>
          <Opt title={L('Lý do từ các lần “chưa hài lòng” của mình', 'Reasons from their own “not quite”')} sub={L('Không bao giờ có tên hay số điện thoại khách.', 'No customer name or phone, ever.')}>
            <Toggle on={s.techSeeReasons} onChange={(v) => set('techSeeReasons', v)} disabled={!s.techSeeOwnScore || readOnly} />
          </Opt>
          <Opt title={L('Bảng xếp hạng cả tiệm', 'Team leaderboard')}>
            <Toggle on={s.techLeaderboard} onChange={(v) => set('techLeaderboard', v)} />
          </Opt>
          <Opt title={L('Báo tôi khi một thợ bị', 'Alert me when a technician gets')}>
            <select value={`${s.alertSameReason}:${s.alertWindowDays}`} onChange={(e) => { const [n, d] = e.target.value.split(':').map(Number); setDraft({ ...s, alertSameReason: n, alertWindowDays: d }); }} style={selStyle}>
              {combos.map(([n, d]) => <option key={`${n}:${d}`} value={`${n}:${d}`}>{L(`${n} lần cùng lý do trong ${d} ngày`, `${n} of the same reason in ${d} days`)}</option>)}
            </select>
          </Opt>
        </div>
      </div>
    </fieldset>
  );
}
