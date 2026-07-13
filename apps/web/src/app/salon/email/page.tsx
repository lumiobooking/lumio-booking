'use client';

// A salon emailing its own customers. Hidden unless Lumio switched the
// `emailMarketing` feature on for this tenant (Super Admin → tenant → features).

import { SalonShell } from '../../../components/SalonShell';
import { EmailCampaigns } from '../../../components/EmailCampaigns';
import { useLang } from '../../../lib/i18n';

export default function SalonEmailPage() {
  const { lang } = useLang();
  const vi = lang === 'vi';
  return (
    <SalonShell>
      <section>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{vi ? 'Email marketing' : 'Email marketing'}</h1>
        <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14, maxWidth: 760 }}>
          {vi
            ? 'Soạn một email đẹp, dán danh sách email khách hàng, bấm gửi. Mail đi từ chính địa chỉ của tiệm (Brevo / Gmail / SMTP đã kết nối trong Cài đặt → Thông báo). Mọi lần gửi đều được lưu lại.'
            : 'Compose a polished email, paste your customer list, hit send. It goes out from your own address (the Brevo / Gmail / SMTP you connected under Settings → Notifications). Every send is logged.'}
        </p>
        <EmailCampaigns base="/email-campaigns" vi={vi} />
      </section>
    </SalonShell>
  );
}
