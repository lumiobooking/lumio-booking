/**
 * The confirmation link goes out because we send it, not because the model
 * remembered to.
 *
 * WHAT HAPPENED
 *
 * After a successful booking the tool result told the model: "share this link
 * so they can view or cancel their appointment: <url>". The model replied
 * "You're all set for Nail Design on Thursday, September 3rd at 2 PM!
 * Confirmation is on the way. 🎉" — warm, correct, and with no link in it. The
 * customer had no way to see, confirm or cancel what had just been booked.
 *
 * That is not a bad model. It is a bad place to put a requirement. Everything
 * inside a tool result is a suggestion to a system that is free to paraphrase;
 * anything that MUST reach the customer has to be appended by code after the
 * model has finished talking. The model still writes the warm sentence — it is
 * better at that than a template — and we attach the one thing that cannot be
 * left out.
 *
 * Appended as a bare URL on its own line, deliberately. The reply may be in
 * Vietnamese, English or a mix of both depending on what the customer wrote,
 * and a URL is the only thing that reads correctly in all of them. Messenger
 * turns it into a tappable preview either way.
 */
export function withBookingLink(text: string, url?: string | null): string {
  const body = String(text ?? '').trim();
  const link = String(url ?? '').trim();
  if (!link) return body;
  // The model DID include it — adding it twice looks like a glitch and invites
  // the customer to wonder which of the two links is the real one.
  if (body.includes(link)) return body;
  return body ? `${body}\n${link}` : link;
}
