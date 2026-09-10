/**
 * Privacy Policy — a real page at /privacy.
 *
 * WHY IT EXISTS
 *
 * Every platform we publish through (TikTok, Meta, Google) asks for a public
 * privacy policy URL and a reviewer clicks it. The `/:slug` rewrite in
 * next.config.js sends any unmatched single segment to a salon's booking page,
 * so a policy URL that is not a real route silently shows a booking form to
 * the reviewer instead. This file makes /privacy a real route, which wins over
 * the rewrite (`afterFiles` runs after real routes).
 *
 * Plain colours only — no var(--c…) backgrounds — so theme-lint has nothing to
 * flag, and the page reads the same everywhere.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Lumio Booking',
  description: 'How Lumio Booking collects, uses and protects information.',
};

const UPDATED = 'September 10, 2026';
const CONTACT = 'support@lumiobooking.com';

export default function PrivacyPage() {
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
        .legal h3{font-size:16px;margin:24px 0 8px;color:#111827}
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

      <h1>Privacy Policy</h1>
      <p className="meta">Last updated: {UPDATED}</p>

      <p>
        Lumio Booking (&ldquo;Lumio&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a booking and marketing platform for
        local service businesses such as salons, spas and barbershops. This policy explains what information we
        collect, why we collect it, and what we do with it.
      </p>
      <p>
        Two groups of people use Lumio, and the policy treats them differently. <strong>Business customers</strong> are
        the salon owners and staff who log in to run their business. <strong>Consumers</strong> are the people who book
        an appointment through a salon&rsquo;s booking page or message a salon.
      </p>

      <h2>1. Information we collect</h2>

      <h3>From business customers</h3>
      <ul>
        <li>Account details: name, email address, phone number, and the salon&rsquo;s business details.</li>
        <li>Content you create in Lumio: appointments, services, prices, staff records, posts and schedules.</li>
        <li>Photos and videos you upload in order to publish them to your own social accounts.</li>
        <li>
          Access tokens for the social accounts you choose to connect (TikTok, Facebook, Instagram, Google Business
          Profile, Zalo). See section 3.
        </li>
      </ul>

      <h3>From consumers</h3>
      <ul>
        <li>Booking details: name, phone number, email address if given, and the service and time chosen.</li>
        <li>Messages you send to a salon through a channel the salon has connected to Lumio, including any photos you attach.</li>
      </ul>

      <h3>Automatically</h3>
      <ul>
        <li>Basic technical logs needed to operate and secure the service: IP address, browser type, timestamps, error traces.</li>
      </ul>

      <p>We do not sell personal information, and we do not buy it.</p>

      <h2>2. How we use information</h2>
      <ul>
        <li>To run the booking system: create, confirm, change and remind about appointments.</li>
        <li>To publish the content a business customer has scheduled, to the accounts that customer connected.</li>
        <li>To deliver messages between a salon and its customers, and to draft replies with the salon&rsquo;s approval settings.</li>
        <li>To provide support, investigate problems, and prevent abuse.</li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>
        We do not use consumer contact details for our own marketing. A salon may message its own customers through
        Lumio; the salon is responsible for having permission to do so.
      </p>

      <h2>3. Connected social accounts</h2>
      <p>
        A business customer may connect their own social accounts to Lumio so that scheduled posts publish
        automatically. Connecting is always done by the account holder, through the platform&rsquo;s own authorisation
        screen. Lumio never asks for, receives or stores a social account password.
      </p>
      <div className="box">
        <p style={{ margin: 0 }}>
          <strong>What we store:</strong> the access and refresh tokens the platform issues, the account&rsquo;s
          public display name and avatar, and the identifier the platform uses for that account.
        </p>
      </div>

      <h3>TikTok</h3>
      <ul>
        <li>
          We request only the permissions we use: <code>user.info.basic</code>, to show you which account is connected,
          and <code>video.publish</code>, to post the content you scheduled.
        </li>
        <li>
          Before every post we ask TikTok for your current creator settings and apply them. Your privacy level is never
          preset by Lumio — you choose it for each post.
        </li>
        <li>We do not read your videos, your followers, your analytics, your inbox or any other account data.</li>
        <li>
          You can disconnect at any time from the Channels page in Lumio, which deletes the stored tokens. You can also
          revoke access from TikTok directly, under Settings and privacy &rarr; Security and permissions &rarr; Manage
          app permissions.
        </li>
      </ul>

      <h3>Meta (Facebook and Instagram), Google Business Profile, Zalo</h3>
      <p>
        The same principles apply: we request the narrowest permissions needed to publish content and to handle
        messages the business has asked us to handle, we store only the tokens and public account identifiers, and
        disconnecting in Lumio deletes them.
      </p>

      <h2>4. Sharing</h2>
      <p>We share information only in these situations:</p>
      <ul>
        <li>
          <strong>With the platform you connected</strong>, in order to carry out what you asked — for example, sending
          your video and caption to TikTok so it appears on your profile.
        </li>
        <li>
          <strong>With service providers</strong> that host and operate Lumio (cloud hosting, database hosting, email
          and SMS delivery, and the AI provider that drafts message replies). They may process information only on our
          instructions.
        </li>
        <li>
          <strong>With the salon</strong> whose booking page or message channel a consumer used. Each salon sees only
          its own data; Lumio keeps every business separated.
        </li>
        <li><strong>When the law requires it</strong>, or to protect the rights and safety of people using Lumio.</li>
      </ul>

      <h2>5. Retention</h2>
      <ul>
        <li>Business account data is kept for as long as the account is active.</li>
        <li>Social access tokens are deleted as soon as you disconnect the account.</li>
        <li>Booking and message records are kept while the salon&rsquo;s account is active, so the salon has its own history.</li>
        <li>
          After an account is closed we delete or anonymise its data within 90 days, except where we must keep records
          longer to comply with the law.
        </li>
      </ul>

      <h2>6. Security</h2>
      <p>
        Traffic to Lumio runs over HTTPS. Access tokens are stored server-side and are never sent to a browser. Staff
        accounts see only what their role allows, and each business&rsquo;s data is isolated from every other
        business&rsquo;s. No system is perfect, but we treat credentials and customer contact details as the most
        sensitive things we hold and design around that.
      </p>

      <h2>7. Your rights</h2>
      <p>
        You may ask us to show you the personal information we hold about you, correct it, or delete it. Business
        customers can do most of this directly inside Lumio. For anything else, write to us at the address below and we
        will respond within 30 days. If you are a consumer who booked with a salon, we will pass your request to that
        salon where the salon is the one holding the record.
      </p>

      <h2>8. Children</h2>
      <p>
        Lumio is a tool for businesses and is not directed at children. We do not knowingly collect personal
        information from anyone under 13. If you believe a child has given us information, contact us and we will
        remove it.
      </p>

      <h2>9. International transfers</h2>
      <p>
        Lumio is operated from Vietnam and serves businesses in the United States and elsewhere. Information may be
        processed in either country and by the service providers listed in section 4.
      </p>

      <h2>10. Changes</h2>
      <p>
        If we change this policy we will update the date at the top of this page, and we will tell business customers
        inside the product when the change is significant.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions, requests, or data deletion: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>

      <footer>Lumio Booking · lumiobooking.com</footer>
    </main>
  );
}
