import { Resend } from 'resend';

export async function sendMentionEmail(to: string, mentionedBy: string, message: string) {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!resendApiKey || !resendFromEmail) return;
  const resend = new Resend(resendApiKey);
  const subject = `You were mentioned in chat by @${mentionedBy}`;
  const html = `<p>You were mentioned in chat by <b>@${mentionedBy}</b>:</p><blockquote>${message}</blockquote>`;
  await resend.emails.send({
    from: resendFromEmail,
    to,
    subject,
    html,
  });
}
