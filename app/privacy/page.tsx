export const metadata = {
  title: 'Privacy Policy – The Top Punter',
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: '#64748b', marginBottom: 32 }}>Last updated: April 8, 2026</p>

      <p>The Top Punter (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy. This policy explains what information we collect, how we use it, and your rights.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Information We Collect</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Account information:</strong> email address and username when you register.</li>
        <li><strong>Tip submissions:</strong> the horse selections you submit each race day.</li>
        <li><strong>Profile data:</strong> avatar selection (stored in our database).</li>
        <li><strong>Push notification tokens:</strong> if you opt in to push notifications, your browser&apos;s push subscription endpoint is stored to deliver notifications.</li>
        <li><strong>Usage data:</strong> standard server logs (IP address, browser type) for security and debugging.</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. How We Use Your Information</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>To operate the competition, track scores, and display leaderboards.</li>
        <li>To send race reminders, result notifications, and app updates (email and push).</li>
        <li>To administer jackpot totals and payment eligibility.</li>
        <li>To respond to support requests.</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. Data Sharing</h2>
      <p>We do not sell your personal information. We use the following third-party services to operate the app:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Supabase</strong> – database and authentication hosting.</li>
        <li><strong>Vercel</strong> – application hosting and deployment.</li>
        <li><strong>Resend</strong> – transactional email delivery.</li>
      </ul>
      <p>Each provider operates under their own privacy policy and complies with applicable data protection laws.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Push Notifications</h2>
      <p>If you grant notification permission, your browser&apos;s push subscription is stored and used solely to deliver race and result notifications from The Top Punter. You can revoke permission at any time in your browser or device settings, which will stop all push notifications.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Data Retention</h2>
      <p>Your account data is retained for as long as your account is active. Race history and scores are retained indefinitely for leaderboard purposes. You may request deletion of your account and associated data by contacting us.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Security</h2>
      <p>All data is transmitted over HTTPS. Authentication is handled by Supabase with industry-standard security practices. We do not store passwords in plain text.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>7. Children&apos;s Privacy</h2>
      <p>The Top Punter is intended for adults aged 18 and over. We do not knowingly collect data from anyone under 18. If you believe a minor has registered, please contact us and we will remove their data.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>8. Your Rights</h2>
      <p>You have the right to access, correct, or delete your personal data. To exercise these rights, contact us at the email below.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>9. Contact</h2>
      <p>For any privacy-related questions or requests:</p>
      <p><strong>Email:</strong> <a href="mailto:admin@thetoppunter.com" style={{ color: '#0ea5e9' }}>admin@thetoppunter.com</a></p>

      <hr style={{ marginTop: 40, borderColor: '#e2e8f0' }} />
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 16 }}>© {new Date().getFullYear()} The Top Punter. All rights reserved.</p>
    </main>
  );
}
