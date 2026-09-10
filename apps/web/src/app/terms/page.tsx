/**
 * Terms of Service — a real page at /terms.
 *
 * Same reason as /privacy: the platforms ask for a public terms URL and a
 * reviewer clicks it, and the `/:slug` rewrite would otherwise hand them a
 * salon booking page. Real routes win over `afterFiles` rewrites, so this file
 * is what makes the URL honest.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — Lumio Booking',
  description: 'The terms that apply to businesses using Lumio Booking.',
};

const UPDATED = 'September 10, 2026';
const CONTACT = 'support@lumiobooking.com';

export default function TermsPage() {
  return (
    <main className="legal">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .legal{max-width:820px;margin:0 auto;padding:48px 20px 96px;background:#ffffff;color:#1f2430;
          font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
        .legal h1{font-size:32px;line-height:1.25;margin:0 0 8px;color:#111827}
        .legal .meta{color:#6b7280;font-size:14px;margin:0 0 40px}
        .legal h2{font-size:20px;margin:40px 0 12px;color:#111827}
        .legal p,.legal li{color:#374151}
        .legal ul{padding-left:22px;margin:12px 0}
        .legal li{margin:6px 0}
        .legal a{color:#b3245f}
        .legal .box{background:#f7f7f9;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin:20px 0}
        .legal footer{margin-top:56px;padding-top:20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:14px}
        @media (max-width:600px){.legal{padding:32px 16px 72px}.legal h1{font-size:26px}}
      `,
        }}
      />

      <h1>Terms of Service</h1>
      <p className="meta">Last updated: {UPDATED}</p>

      <p>
        These terms govern your use of Lumio Booking (&ldquo;Lumio&rdquo;), a booking and marketing platform for local
        service businesses. By creating an account or using the service you agree to them.
      </p>

      <h2>1. Who may use Lumio</h2>
      <p>
        Lumio is for businesses. You must be at least 18 years old and authorised to act for the business you register.
        You are responsible for everything done under your account, including by your staff, and for keeping your login
        details private.
      </p>

      <h2>2. What we provide</h2>
      <ul>
        <li>An online booking page and appointment calendar for your business.</li>
        <li>Tools to write, schedule and publish content to social accounts you connect.</li>
        <li>Tools to receive and answer customer messages on the channels you connect.</li>
      </ul>
      <p>
        We work to keep the service available, but we do not promise uninterrupted service. We may change or improve
        features over time. If we plan to remove something you rely on, we will give you reasonable notice.
      </p>

      <h2>3. Your content</h2>
      <p>
        You keep ownership of everything you upload — photos, videos, captions, business information. You grant us the
        limited permission needed to store it and to publish it where you told us to publish it, and nothing more.
      </p>
      <p>You are responsible for having the rights to what you publish. In particular you agree not to use Lumio to:</p>
      <ul>
        <li>publish content you do not own or have permission to use, including music, footage and images;</li>
        <li>publish content that is unlawful, deceptive, hateful, sexually explicit, or that harasses anyone;</li>
        <li>make claims that break advertising rules in your market, including health, medical and financial claims;</li>
        <li>impersonate another business or person;</li>
        <li>send messages to people who have not agreed to receive them.</li>
      </ul>

      <h2>4. Connected accounts and platform rules</h2>
      <p>
        When you connect a social account, you authorise Lumio to act on that account only as you direct it — for
        example, to publish a post you scheduled. You may disconnect at any time.
      </p>
      <div className="box">
        <p style={{ margin: 0 }}>
          Content you publish through Lumio must also follow the rules of the platform it goes to: TikTok&rsquo;s
          Community Guidelines and Terms of Service, Meta&rsquo;s Community Standards, Google Business Profile content
          policy, and Zalo&rsquo;s terms. Those platforms may remove content or restrict an account regardless of
          anything in these terms.
        </p>
      </div>
      <p>
        Lumio screens content before publishing to help you stay inside those rules, but the check is a safeguard, not
        a guarantee. Final responsibility for what you publish is yours.
      </p>

      <h2>5. Fees</h2>
      <p>
        Paid plans are billed in advance for the period shown when you subscribe. Fees are non-refundable except where
        the law requires otherwise. We will give you notice before a price change takes effect, and you may cancel
        before it does.
      </p>

      <h2>6. Suspension and termination</h2>
      <p>
        You may stop using Lumio and close your account at any time. We may suspend or close an account that breaks
        these terms, that puts the service or other users at risk, or that has unpaid fees. Where circumstances allow,
        we will warn you first and give you a chance to put things right. After closure we handle your data as
        described in our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        Lumio connects to services we do not control. If one of them changes its rules, restricts its interface, or
        becomes unavailable, the related feature in Lumio may change or stop working. That is outside our control and
        is not a breach of these terms.
      </p>

      <h2>8. Disclaimers and liability</h2>
      <p>
        Lumio is provided &ldquo;as is&rdquo;. To the extent the law allows, we exclude implied warranties, and we are
        not liable for indirect or consequential loss, lost profits, or lost data. Where liability cannot be excluded,
        it is limited to the fees you paid us in the twelve months before the claim.
      </p>
      <p>Nothing here limits liability for fraud, or for anything that cannot lawfully be limited.</p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms. We will change the date at the top of this page and tell you inside the product when
        a change is significant. Continuing to use Lumio after a change means you accept it.
      </p>

      <h2>10. Contact</h2>
      <p>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>

      <footer>Lumio Booking · lumiobooking.com</footer>
    </main>
  );
}
