/**
 * Is anybody actually running this salon's marketing?
 *
 * WHY THE QUESTION EXISTS
 *
 * A week plan is generated for EVERY tenant on the platform, whether or not
 * anyone is working on its marketing. The shop's screen ships open for every
 * salon, which is only defensible because it stays empty until the agency puts
 * something on it — handing marketing homework to a shop that bought a booking
 * system and nothing else is worse than showing it nothing.
 *
 * WHAT COUNTS AS EVIDENCE, AND WHY IT WIDENED
 *
 * The first version asked one question: has a suggestion been sent, or a post
 * been scheduled? That was right when the shop's screen held nothing but
 * chores. It is too narrow now that the screen holds the PLAN: a salon whose
 * week the team has written, ticked, approved or priced is a salon being run,
 * and it would sit staring at "nothing to do yet" until the day the first clip
 * request went out. So the plan's own traces count too.
 *
 * Every signal here is something only the agency's own work creates. None of
 * them is a setting somebody could forget to switch on, which is the property
 * that matters: the answer is true exactly when somebody is doing the work.
 *
 * WHY SETUP COUNTS, AND WHY IT IS NOT A SETTING
 *
 * All four original signals are things that happen AFTER the relationship is
 * running. A salon the team spent an afternoon setting up — profile written,
 * Page connected, services entered — then opened its own screen and read
 * "chưa có việc nào cho tiệm", for however many days it took somebody to send
 * the first clip request. The shop's first impression of the thing it is
 * paying for was an empty box.
 *
 * `support.entered_salon` fixes that without weakening the rule. It is written
 * when a member of staff enters a salon through support — it IS the agency
 * working, recorded by the act itself. Nobody can forget to switch it on,
 * because there is nothing to switch: setting the salon up is what creates it.
 * A shop that signed up on its own and only ever used the booking system has
 * no such row, and still sees nothing.
 */

export interface AgencyWorkEvidence {
  /** A suggestion the TEAM sent (a card the shop answers). Shop-sent ones do not count. */
  teamSuggestion?: boolean;
  /** A post scheduled for this salon. */
  scheduledPost?: boolean;
  /** Recent week rows: has any been edited, approved, or ticked? */
  weeks?: { edited?: unknown; approvedAt?: unknown; ticks?: unknown }[];
  /** The offer form has been filled in for this salon. */
  offerSet?: boolean;
  /**
   * A member of Lumio staff has entered this salon through support — the
   * audit row `support.entered_salon`. Written by the act of doing the setup,
   * so it cannot be left unset by mistake.
   */
  staffSetup?: boolean;
}

/** Has this week row been touched by a person, on either side? */
export function weekTouched(w: { edited?: unknown; approvedAt?: unknown; ticks?: unknown } | null | undefined): boolean {
  if (!w) return false;
  if (w.edited !== null && w.edited !== undefined && Object.keys(w.edited as object).length > 0) return true;
  if (w.approvedAt) return true;
  const ticks = w.ticks;
  return Boolean(ticks && typeof ticks === 'object' && Object.keys(ticks as object).length > 0);
}

export function hasAgencyWork(e: AgencyWorkEvidence): boolean {
  return Boolean(e.teamSuggestion)
    || Boolean(e.scheduledPost)
    || Boolean(e.offerSet)
    || Boolean(e.staffSetup)
    || (e.weeks ?? []).some(weekTouched);
}
