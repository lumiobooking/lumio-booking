'use client';

import { SalonShell } from '../../../components/SalonShell';
import { InboxView } from '../../../components/InboxView';

/** The owner's way in. The screen itself is shared with the staff portal. */
export default function SalonInboxPage() {
  return (
    <SalonShell>
      <InboxView />
    </SalonShell>
  );
}
