'use client';

/**
 * rt198 — "Vào ca / Ra ca". One button for a team member: pressed at the start
 * of the shift, they take customers and their phone rings with Lumio closed;
 * Lumio ends the shift by itself after their working hours. If this person has
 * no phone that gets alerts, say so right here — that is the one thing that
 * makes them miss customers.
 */

const GO_GREEN = '#16a34a';
const goBtn: React.CSSProperties = {
  height: 44, borderRadius: 11, border: 0, background: GO_GREEN, color: '#fff',
  fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
};

const hhmm = (iso: string) => { try { return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };

export function ShiftButton({ vi, on, until, busy, devices, pushOn, onToggle }: {
  vi: boolean; on: boolean; until: string | null; busy: boolean;
  devices?: number; pushOn?: boolean; onToggle: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const noPhone = devices === 0;
  const hint = pushOn === false
    ? L('Máy chủ chưa bật thông báo — báo chủ tiệm.', 'Push is off on the server — tell the owner.')
    : noPhone ? L('Điện thoại của bạn chưa bật thông báo — bấm “Bật thông báo” ở ô phía trên, nếu không sẽ không reo khi có khách.', 'None of your phones gets alerts — tap “Turn on” above, or it will not ring when a customer comes.')
    : null;

  if (!on) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={onToggle} disabled={busy} style={{ ...goBtn, opacity: busy ? 0.6 : 1 }}>
          ▶ {L('Vào ca', 'Start shift')}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.4, textAlign: 'center' }}>
          {L('Bấm khi bắt đầu làm — khách mới sẽ được chia cho bạn và điện thoại reo.', 'Press when you start — new customers come to you and your phone rings.')}
        </span>
        {hint && <span style={{ fontSize: 11.5, color: 'var(--ink-warn)', fontWeight: 600, lineHeight: 1.4 }}>{hint}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px', borderRadius: 11, border: '1px solid var(--ink-good)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--ink-good)', flexShrink: 0 }} />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
          <b style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>{L('Đang trong ca — nhận khách', 'On shift — taking customers')}</b>
          {until && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{L(`Tự ra ca lúc ${hhmm(until)}`, `Ends by itself at ${hhmm(until)}`)}</span>}
        </span>
      </span>
      {hint && <span style={{ fontSize: 11.5, color: 'var(--ink-warn)', fontWeight: 600, lineHeight: 1.4 }}>{hint}</span>}
      <button type="button" onClick={onToggle} disabled={busy} style={{ height: 34, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
        ■ {L('Ra ca', 'End shift')}
      </button>
    </div>
  );
}
