'use client';

import { StaffShell } from '../../../components/StaffShell';
import { InboxView } from '../../../components/InboxView';

/**
 * The technician's way in — the SAME screen the owner uses.
 *
 * Answering a customer is the job most staff do most often, so it is not a
 * cut-down version. What differs is enforced on the server, per route, and
 * tested there: staff can answer, tag, note and hand over; they cannot touch
 * the Facebook connection, the bot's instructions or the price facts.
 */
export default function StaffInboxPage() {
  return (
    <StaffShell title="Inbox" wide>
      <InboxView />
    </StaffShell>
  );
}
