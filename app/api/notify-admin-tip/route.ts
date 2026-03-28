import { Resend } from 'resend';
import { getSupabaseClient } from '../../../lib/supabase';
import { fetchRacesForCourse } from '../../../lib/betfair';

export const maxDuration = 30;

export async function POST(request: Request) {
  try {

    const { username, selections, wildcard } = await request.json();
    if (!username || !Array.isArray(selections)) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Prepare user-friendly wildcard info
    let wildcardText = '';
    if (wildcard && wildcard.meetId && wildcard.raceId) {
      try {
        const { races } = await fetchRacesForCourse(wildcard.meetId, new Date().toISOString().slice(0, 10));
        const race = races.find(r => String(r.id) === String(wildcard.raceId));
        if (race) {
          wildcardText = `${race.courseId} - ${race.name}`;
        } else {
          wildcardText = `${wildcard.meetId} - ${wildcard.raceId}`;
        }
      } catch {
        wildcardText = `${wildcard.meetId} - ${wildcard.raceId}`;
      }
    }

    const supabase = getSupabaseClient();
    // Fetch all admin users
    const { data: admins, error } = await supabase
      .from('profiles')
      .select('email,username')
      .eq('is_admin', true);
    if (error) {
      return Response.json({ error: 'Failed to fetch admins' }, { status: 500 });
    }
    if (!admins || admins.length === 0) {
      return Response.json({ error: 'No admin users found' }, { status: 404 });
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    if (!resendApiKey || !resendFromEmail) {
      return Response.json({ error: 'Email not configured' }, { status: 500 });
    }
    const resend = new Resend(resendApiKey);

    const subject = `New Tips Submitted by ${username}`;
    const html = `
      <div style=\"font-family: sans-serif; max-width: 600px; margin: 0 auto;\">
        <h2>New Tips Submitted</h2>
        <p><strong>User:</strong> ${username}</p>
        <p><strong>Selections:</strong></p>
        <ul>
          ${selections.map((sel: any) => `<li>${sel.meetCourse || sel.meetId} - ${sel.raceName}: ${sel.horseName}</li>`).join('')}
        </ul>
        ${wildcardText ? `<p><strong>Wildcard:</strong> ${wildcardText}</p>` : ''}
        <p style=\"color: #999; font-size: 12px;\">This is an automated notification from The Top Punter.</p>
      </div>
    `;

    // Send to all admins
    const emailPromises = admins.map((admin: any) =>
      resend.emails.send({
        from: resendFromEmail,
        to: admin.email,
        subject,
        html,
      })
    );
    await Promise.allSettled(emailPromises);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: 'Failed to notify admins' }, { status: 500 });
  }
}
