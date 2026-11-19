/**
 * rt210 — the standard chat-turn setup, ready-made.
 *
 * The owner: "nghiên cứu hệ thống lớn như Pancake họ đang hoạt động như thế
 * nào, setup sẵn cho tôi mặc định như vậy; muốn thay đổi thì tôi chỉnh lại."
 *
 * What the big inboxes do (Pancake "Chế độ xoay vòng", Harasocial auto-assign,
 * Subiz, respond.io), and the value chosen here:
 *  - Round robin among the people who are THERE (online / on shift) — for a
 *    sales team every lead gets an equal chance.            → strict rotation, online only
 *  - Recall a conversation the person has not even opened after a few minutes,
 *    and pass it on; a limited number of times.            → 3 min unopened, 5 min unanswered, max 3 passes
 *  - Ad leads are the most expensive: shortest wait.      → 2 min
 *  - A cap of open conversations per person.               → 10 (Lumio's old 5 starved a busy team)
 *  - A returning customer goes back to the person who served them.  → kept (the conversation stays theirs)
 *  - Nobody answers at all: someone is told.               → 10 min: owner + everyone on shift
 *  - Staff see their own conversations and the unclaimed ones.      → staffSeeAll off, no taking others'
 *  - When nobody is free the customer is not left alone.  → the AI answers first (bot first)
 * Working hours are not a condition: pressing "Vào ca" (or having Lumio open)
 * is the signal, as in Pancake.
 */
export const STANDARD_SETTINGS = {
  rotation: 'strict' as const,
  botFirst: true,
  needStatus: true,
  needShift: false,
  needOnline: true,
  onlineMins: 10,
  maxOpenPerAgent: 10,
  preferUsualTech: true,
  reassignUnreadMins: 3,
  reassignUnrepliedMins: 5,
  reassignAdMins: 2,
  maxHops: 3,
  escalateMins: 10,
};

export const STANDARD_TEAM = {
  adGroupFirst: true,
  staffSeeAll: false,
  staffCanTake: false,
  maskPhones: false,
  nightReport: true,
};

/** Column names behind each setting (messenger_connections). */
export const SETTING_COLUMNS: Record<keyof typeof STANDARD_SETTINGS, string> = {
  rotation: 'chatRotation', botFirst: 'chatBotFirst', needStatus: 'chatNeedStatus', needShift: 'chatNeedShift',
  needOnline: 'chatNeedOnline', onlineMins: 'chatOnlineMins', maxOpenPerAgent: 'chatMaxOpenPerAgent',
  preferUsualTech: 'chatPreferUsualTech', reassignUnreadMins: 'chatReassignUnreadMins',
  reassignUnrepliedMins: 'chatReassignUnrepliedMins', reassignAdMins: 'chatReassignAdMins', maxHops: 'chatMaxHops',
  escalateMins: 'chatEscalateMins',
};

/** The standard values as column writes, leaving out anything the owner sent in the same save. */
export function standardColumns(except: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(SETTING_COLUMNS)) {
    if (except[k] !== undefined) continue;
    out[col] = STANDARD_SETTINGS[k as keyof typeof STANDARD_SETTINGS];
  }
  return out;
}

/**
 * Turning chat turns on for the first time, with every timer still at 0 (never
 * set): fill in the standard so it works out of the box. A salon that set its
 * own timers is left exactly as it was.
 */
export function firstEnable(before: { mode: string; reassignUnreadMins: number; reassignUnrepliedMins: number; reassignAdMins: number; escalateMins: number }, nextMode: unknown): boolean {
  return nextMode === 'round-robin' && before.mode !== 'round-robin'
    && !before.reassignUnreadMins && !before.reassignUnrepliedMins && !before.reassignAdMins && !before.escalateMins;
}
