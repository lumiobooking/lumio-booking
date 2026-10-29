import ApptPage from '../../appt/[token]/page';

/**
 * /a/<code> — the SMS-sized self-service link (view / confirm / cancel).
 *
 * The same page as /appt/<token>: texts carry a 33-character signed code
 * instead of the ~180-character token, because a text is billed per 153
 * characters. The API verifies both forms, so links already sent keep working.
 */
export default function ShortApptPage() {
  return <ApptPage />;
}
