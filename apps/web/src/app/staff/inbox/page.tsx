'use client';

import { StaffShell } from '../../../components/StaffShell';
import { InboxView } from '../../../components/InboxView';
import { useAuth } from '../../../lib/auth';
import { useChatSeatState } from '../../../lib/chat-seat';

/**
 * The technician's way in to customer messages — the SAME Inbox the owner uses.
 *
 * rt208: open to whoever the owner ticked in Chia turn (or whose role opens the
 * Inbox). Before, this page only showed "managed by Lumio Agency", while the
 * chat-turn rules were giving those very people customers — who then went
 * round the team unopened. What staff may do inside is enforced on the server,
 * per route, as for the owner's screen.
 */
export default function StaffInboxPage() {
  const { token } = useAuth();
  const seat = useChatSeatState(token);
  if (seat === 'loading') {
    // rt214: still asking — never flash "not allowed" at someone who is.
    return (
      <StaffShell title="Tin nhắn" wide>
        <div style={{ textAlign: 'center', padding: '80px 16px', fontSize: 13.5, color: 'var(--c94a3b8)' }}>Đang mở tin nhắn…</div>
      </StaffShell>
    );
  }
  if (seat === 'yes') {
    return (
      <StaffShell title="Tin nhắn" wide>
        <InboxView />
      </StaffShell>
    );
  }
  return (
    <StaffShell title="Inbox" wide>
      <div style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center', background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 28px' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>💬</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 19, color: 'var(--cf8fafc)' }}>Bạn chưa được giao trả lời tin nhắn</h2>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--c94a3b8)' }}>
          Nhờ chủ tiệm vào <b>Hộp thư → Chia turn</b> và <b>tích tên bạn</b> (hoặc đổi vai trò sang <b>Tư vấn tin nhắn</b>). Sau đó mở lại trang này.
        </p>
      </div>
    </StaffShell>
  );
}
