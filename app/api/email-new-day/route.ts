import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { fetchRacesForCourse } from '../../../lib/theracingapi';

type Meet = {
  meet_id: string;
  course: string;
  date: string;
  raceType?: 'Thoroughbred' | 'Harness';
};

type Profile = {
  id: string;
  email: string;
  username: string;
};

type ProfileRow = {
  id: string | null;
  email: string | null;
  username: string | null;
};

type NewDayEmailRequestBody = {
  meets?: Meet[];
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (isoValue: string) => {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    dateLabel: parsed.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    timeLabel: parsed.toLocaleTimeString('en-AU', {
      timeZone: 'Australia/Sydney',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as NewDayEmailRequestBody));

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.slice(7);
    if (!accessToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    if (!resendApiKey || !resendFromEmail) {
      return Response.json(
        { error: 'Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase environment variables are missing.' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (ownProfileError || !ownProfile?.is_admin) {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const meetsFromBody: Meet[] = Array.isArray(body.meets) ? body.meets : [];
    let meets: Meet[] = meetsFromBody;

    if (!meets.length) {
      const { data: settings, error: settingsError } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'global_meets')
        .maybeSingle();

      if (settingsError) {
        return Response.json({ error: `Unable to load global meets. ${settingsError.message}` }, { status: 500 });
      }

      meets = Array.isArray(settings?.value) ? settings.value : [];
    }

    if (!meets.length) {
      return Response.json({ error: 'No active meets found to announce.' }, { status: 400 });
    }

    const raceData = await Promise.allSettled(
      meets.map((meet) =>
        fetchRacesForCourse(
          String(meet.meet_id || ''),
          String(meet.date || new Date().toISOString().slice(0, 10)),
          false,
          meet.raceType === 'Harness' ? 'Harness' : 'Thoroughbred'
        )
      )
    );

    let earliestStartIso: string | null = null;
    raceData.forEach((result) => {
      if (result.status !== 'fulfilled') {
        return;
      }

      for (const race of result.value.races || []) {
        const raceTime = String(race.time || '').trim();
        if (!raceTime) continue;
        const parsed = new Date(raceTime);
        if (Number.isNaN(parsed.getTime())) continue;

        if (!earliestStartIso || parsed.getTime() < new Date(earliestStartIso).getTime()) {
          earliestStartIso = parsed.toISOString();
        }
      }
    });

    const earliestStart = earliestStartIso ? formatDateTime(earliestStartIso) : null;

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,email,username');

    if (profilesError) {
      return Response.json({ error: `Unable to load user emails. ${profilesError.message}` }, { status: 500 });
    }

    const profileRows: ProfileRow[] = Array.isArray(profiles) ? (profiles as ProfileRow[]) : [];

    const recipients: Profile[] = profileRows
      .map((profile) => ({
        id: String(profile.id || ''),
        email: String(profile.email || '').trim(),
        username: String(profile.username || '').trim(),
      }))
      .filter((profile) => Boolean(profile.email));

    if (!recipients.length) {
      return Response.json({ error: 'No user emails found.' }, { status: 400 });
    }

    const uniqueEmails = [...new Set(recipients.map((entry) => entry.email))];

    if (!uniqueEmails.length) {
      return Response.json({ error: 'No user emails found.' }, { status: 400 });
    }

    const meetListHtml = meets
      .map((meet) => {
        const date = String(meet.date || '').trim();
        const raceType = meet.raceType === 'Harness' ? 'Harness' : 'Thoroughbred';
        return `<li><strong>${escapeHtml(String(meet.course || 'Unknown meet'))}</strong> (${escapeHtml(raceType)})${date ? ` - ${escapeHtml(date)}` : ''}</li>`;
      })
      .join('');

    const earliestStartLine = earliestStart
      ? `<p style="margin: 0 0 12px 0;"><strong>Earliest start:</strong> ${escapeHtml(earliestStart.dateLabel)} at ${escapeHtml(earliestStart.timeLabel)} (AEST/AEDT)</p>`
      : '<p style="margin: 0 0 12px 0;"><strong>Earliest start:</strong> Time to be confirmed</p>';

    const meetDate = String(meets[0]?.date || new Date().toISOString().slice(0, 10));

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 680px; margin: 0 auto; color: #0f172a;">
        <h2 style="margin-bottom: 8px;">New Race Day Is Live</h2>
        <p style="margin-top: 0; color: #475569;">A new set of race meets has been published for today.</p>
        ${earliestStartLine}
        <h3 style="margin-top: 20px; margin-bottom: 8px;">Race Meets</h3>
        <ul style="padding-left: 20px; margin-top: 0;">${meetListHtml}</ul>
        <p style="margin-top: 18px; margin-bottom: 0;">
          <a href="https://thetoppunter.com" style="color: #2563eb; text-decoration: none;">Open The Top Punter</a>
        </p>
        <p style="margin-top: 20px; color: #64748b; font-size: 12px;">Sent from The Top Punter admin panel.</p>
      </div>
    `;

    const resend = new Resend(resendApiKey);

    const sendResults = await Promise.allSettled(
      uniqueEmails.map((email) =>
        resend.emails.send({
          from: resendFromEmail,
          to: email,
          subject: `New Race Day Meets - ${meetDate}`,
          html,
        })
      )
    );

    const sentCount = sendResults.filter((result) => result.status === 'fulfilled').length;
    const failedCount = sendResults.length - sentCount;

    return Response.json({
      success: true,
      recipients: uniqueEmails.length,
      sentCount,
      failedCount,
      mode: 'broadcast',
      earliestStart,
    });
  } catch (error) {
    console.error('email-new-day error:', error);
    return Response.json({ error: 'Failed to send new day meets email.' }, { status: 500 });
  }
}
