'use client';

/**
 * WALK-IN 2.0, STEP 2 — "Quy tắc quầy": the desk's optional rules, one place.
 * Every rule is OFF until the owner turns it on; the turn rules (who goes
 * next) live in their own drawer and are not touched here. Staff can read the
 * rules; only the owner (or a Lumio support session) can change them — the
 * API enforces that too.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui } from '../lib/ui';

interface DeskPolicy {
  requireService: boolean; overrideReason: boolean; protectBooking: boolean; bookingBufferMin: number;
  waitTargetMin: number; payNudge: boolean; payNudgeMin: number;
  notifyAhead: number; noShowMin: number;
}

export function DeskPolicyPanel({ vi, canEdit, onClose, onSaved }: { vi: boolean; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [p, setP] = useState<DeskPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const L = (a: string, b: string) => (vi ? a : b);

  useEffect(() => {
    if (!token) return;
    apiFetch<DeskPolicy>('/walkins/desk-policy', { token }).then(setP).catch((e) => setError(e instanceof Error ? e.message : 'error'));
  }, [token]);

  async function save() {
    if (!p || !token) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      setP(await apiFetch<DeskPolicy>('/walkins/desk-policy', { method: 'PATCH', token, body: p }));
      setSaved(true); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setSaving(false); }
  }

  const set = <K extends keyof DeskPolicy>(k: K, v: DeskPolicy[K]) => { setSaved(false); setP((cur) => (cur ? { ...cur, [k]: v } : cur)); };

  const content = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 210, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} aria-label={L('Quy tắc quầy', 'Desk rules')}
        style={{ width: 'min(560px, 100vw)', height: '100%', overflowY: 'auto', background: 'var(--c111827)', borderLeft: '1px solid var(--line)', padding: '18px 20px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 19, color: 'var(--cf8fafc)' }}>{L('Quy tắc quầy', 'Desk rules')}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.45 }}>
              {L('Tất cả mặc định tắt. Quy tắc chia tua (ai tới lượt) giữ nguyên, sửa ở "Chi tiết tua · quy tắc".', 'All off by default. Turn rules (who goes next) stay as they are — see "Turn details · rules".')}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--line)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ ...ui.banner, marginTop: 12 }}>{error}</div>}
        {!p ? <div style={{ color: 'var(--c94a3b8)', marginTop: 16 }}>…</div> : (
          <div style={{ marginTop: 10 }}>
            <Row title={L('Phải có dịch vụ trước khi bấm Xong', 'A service before finishing')}
              hint={L('Thợ / quầy không bấm Xong hay chuyển khách ra tính tiền khi phiếu chưa có dịch vụ. "Đóng không thu" vẫn dùng được.', 'No Done / send-to-pay on a ticket without a service. "Close without payment" still works.')}>
              <Switch canEdit={canEdit} on={p.requireService} label={L('Phải có dịch vụ', 'Require a service')} onChange={(v) => set('requireService', v)} />
            </Row>
            <Row title={L('Giao thợ khác gợi ý phải có lý do', 'A reason when not seating the suggested tech')}
              hint={L('Máy gợi ý thợ theo quy tắc tua; quầy chọn người khác thì chọn lý do. Lần nào cũng được ghi vào lịch sử.', 'The rules suggest a technician; picking someone else asks why. Every override is logged.')}>
              <Switch canEdit={canEdit} on={p.overrideReason} label={L('Bắt buộc lý do', 'Require a reason')} onChange={(v) => set('overrideReason', v)} />
            </Row>
            <Row title={L('Giữ thợ cho khách có hẹn', 'Keep techs for their bookings')}
              hint={L('Không giao khách walk-in cho thợ nếu làm xong sẽ trễ giờ hẹn kế tiếp của thợ đó (cộng phút đệm).', 'No walk-in for a technician who would still be busy when her next booking starts (plus a buffer).')}>
              <Num canEdit={canEdit} value={p.bookingBufferMin} min={0} max={60} label={L('Phút đệm', 'Buffer minutes')} unit={L('phút đệm', 'min buffer')} onChange={(v) => set('bookingBufferMin', v)} />
              <Switch canEdit={canEdit} on={p.protectBooking} label={L('Giữ thợ cho khách có hẹn', 'Keep techs for bookings')} onChange={(v) => set('protectBooking', v)} />
            </Row>
            <Row title={L('Mục tiêu thời gian chờ', 'Waiting-time target')}
              hint={L('Khách chờ quá 2 lần mức này hiện màu cam, quá 4 lần hiện màu đỏ.', 'A wait over 2× this turns amber, over 4× red.')}>
              <Num canEdit={canEdit} value={p.waitTargetMin} min={3} max={120} label={L('Phút', 'Minutes')} unit={L('phút', 'min')} onChange={(v) => set('waitTargetMin', v)} />
            </Row>
            <Row title={L('Báo quầy khi chờ tính tiền quá lâu', 'Nudge the desk when waiting to pay')}
              hint={L('Phiếu chờ tính tiền quá số phút này: thẻ chuyển cam và điện thoại của quầy/chủ nhận thông báo (1 lần mỗi phiếu).', 'Past this many minutes the card turns amber and the desk / owner phones get one push per visit.')}>
              <Num canEdit={canEdit} value={p.payNudgeMin} min={3} max={240} label={L('Phút', 'Minutes')} unit={L('phút', 'min')} onChange={(v) => set('payNudgeMin', v)} />
              <Switch canEdit={canEdit} on={p.payNudge} label={L('Báo quầy', 'Nudge')} onChange={(v) => set('payNudge', v)} />
            </Row>
            <Row title={L('Nhắn tin "Sắp tới lượt"', 'Text "you\'re almost up"')}
              hint={L('Gửi 1 tin cho khách có số điện thoại khi còn từ số người này trở xuống phía trước (0 = tắt). Tin nhắn tính vào lượt SMS của gói.', 'One text when this many people or fewer are ahead (0 = off). Counts toward the plan\'s SMS.')}>
              <Num canEdit={canEdit} value={p.notifyAhead ?? 0} min={0} max={5} label={L('Số người phía trước', 'People ahead')} unit={L('người', 'people')} onChange={(v) => set('notifyAhead', v)} />
            </Row>
            <Row title={L('Khách được gọi mà không có mặt', 'Called but not here')}
              hint={L('Sau số phút này kể từ lúc bấm "Gọi", khách tự rời hàng chờ và ghi là vắng mặt (0 = tắt, quầy tự bấm "Vắng mặt").', 'This many minutes after "Call", the customer leaves the queue as a no-show (0 = off; the desk presses "No-show").')}>
              <Num canEdit={canEdit} value={p.noShowMin ?? 0} min={0} max={60} label={L('Phút', 'Minutes')} unit={L('phút', 'min')} onChange={(v) => set('noShowMin', v)} />
            </Row>
            {canEdit ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <button type="button" onClick={save} disabled={saving} style={{ ...ui.primaryBtn, padding: '10px 18px' }}>{saving ? '…' : L('Lưu quy tắc', 'Save rules')}</button>
                {saved && <span style={{ fontSize: 13, color: 'var(--ink-good)', fontWeight: 600 }}>{L('Đã lưu', 'Saved')}</span>}
              </div>
            ) : (
              <div style={hint}>{L('Chỉ chủ tiệm sửa được các quy tắc này.', 'Only the owner can change these rules.')}</div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}

function Switch({ on, label, onChange, canEdit }: { on: boolean; label: string; onChange: (v: boolean) => void; canEdit: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={!canEdit} onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 46, height: 28, borderRadius: 999, border: 0, flexShrink: 0, cursor: canEdit ? 'pointer' : 'default', background: on ? '#4f46e5' : 'var(--c334155)', opacity: canEdit ? 1 : 0.6 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#ffffff', transition: 'left .12s' }} />
    </button>
  );
}
function Num({ value, min, max, label, unit, onChange, canEdit }: { value: number; min: number; max: number; label: string; unit: string; onChange: (v: number) => void; canEdit: boolean }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
      <input type="number" min={min} max={max} value={value} disabled={!canEdit} aria-label={label}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))}
        style={{ width: 64, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, color: 'var(--ce2e8f0)', fontSize: 13, padding: '6px 8px', textAlign: 'right' }} />
      {unit}
    </label>
  );
}
function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}


const hint: CSSProperties = { fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 14 };
