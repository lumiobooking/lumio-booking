'use client';

import { StaffShell } from '../../../components/StaffShell';

/**
 * The technician's way in — the SAME screen the owner uses.
 *
 * Answering a customer is the job most staff do most often, so it is not a
 * cut-down version. What differs is enforced on the server, per route, and
 * tested there: staff can answer, tag, note and hand over; they cannot touch
 * the Facebook connection, the bot's instructions or the price facts.
 */
export default function StaffInboxPage() {
  // The unified inbox is operated by Lumio's team from support sessions, not
  // by salon staff — see lib/support-gate. Staff accounts landing here (an old
  // bookmark, a shared link) get the sign on the door, not the machinery.
  return (
    <StaffShell title="Inbox" wide>
      <div style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center', background: 'var(--c111827)', border: '1px solid var(--c1e293b)', borderRadius: 14, padding: '36px 28px' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>🛠</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 19, color: 'var(--cf8fafc)' }}>Mục này do Lumio Agency quản lý</h2>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'var(--c94a3b8)' }}>Tin nhắn khách được đội ngũ Lumio theo dõi và phản hồi. Cần gì, nhắn Lumio nhé.</p>
      </div>
    </StaffShell>
  );
}
