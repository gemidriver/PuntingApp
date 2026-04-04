import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMarketRunners } from '../../../../lib/theracingapi';

export const preferredRegion = 'syd1';

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId') || '';

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase environment variables are missing.' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.slice(7);
    if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (ownProfileError || !ownProfile?.is_admin) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    // Allow simulation via JSON body: { simulate: [{ id, name, status }], targetUserIds: [<uuid>] }
    let scratched: any[] = [];
    try {
      const body = await request.json();
      if (body && Array.isArray(body.simulate)) {
        scratched = body.simulate.filter((r: any) => String(r.status ?? '').toUpperCase() === 'REMOVED');
      }
    } catch (e) {
      // ignore parse errors - fall back to live fetch
    }

    if (!scratched.length) {
      // fallback to live data when no simulation provided
      const runners = await fetchMarketRunners(marketId, true);
      scratched = (runners || []).filter((r) => String(r.status ?? '').toUpperCase() === 'REMOVED');
    }

    if (!scratched.length) {
      return NextResponse.json({ success: true, message: 'No scratches found', scratched: [] });
    }

    // Load users to notify. If request body included targetUserIds, notify only those.
    let profiles: any[] | null = null;
    try {
      const body = await request.json().catch(() => null);
      if (body && Array.isArray(body.targetUserIds) && body.targetUserIds.length) {
        const { data: p, error: profilesError } = await supabase
          .from('profiles')
          .select('id,email,username')
          .in('id', body.targetUserIds as string[]);
        if (profilesError) {
          return NextResponse.json({ error: `Unable to load target users. ${profilesError.message}` }, { status: 500 });
        }
        profiles = p as any[];
      } else {
        const { data: all, error: profilesError } = await supabase.from('profiles').select('id,email,username');
        if (profilesError) {
          return NextResponse.json({ error: `Unable to load users. ${profilesError.message}` }, { status: 500 });
        }
        profiles = all as any[];
      }
    } catch (e) {
      return NextResponse.json({ error: 'Unable to load users.' }, { status: 500 });
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    const resend = resendApiKey && resendFromEmail ? new Resend(resendApiKey) : null;

    const subjectBase = `Scratch update for market ${marketId}`;

    // Load submissions for recipient users so we can personalize messages and only notify affected users
    const recipientIds = (profiles || []).map((p: any) => p.id).filter(Boolean);
    const { data: submissions, error: submissionsError } = await supabase
      .from('user_submissions')
      .select('user_id,username,selections,wildcard,submitted')
      .in('user_id', recipientIds as string[]);

    if (submissionsError) {
      console.error('Unable to load submissions for recipients', submissionsError);
    }

    const insertNotes: any[] = [];
    let sentCount = 0;

    // Build per-user messages only for users whose submission included a scratched runner
    const emailsToSend: { to: string; html: string; subject: string }[] = [];

    for (const p of profiles || []) {
      if (!p?.email) continue;
      const submission = (submissions || []).find((s: any) => s.user_id === p.id);
      const affectedSelections: any[] = [];

      if (submission && Array.isArray(submission.selections)) {
        for (const s of submission.selections) {
          // Compare by horseId or by name if id missing
          const matchById = scratched.some((r) => String(r.id) && String(r.id) === String(s.horseId));
          const matchByName = scratched.some((r) => String(r.name || '').trim().toLowerCase() === String(s.horseName || '').trim().toLowerCase());
          if (matchById || matchByName) {
            affectedSelections.push({ raceId: s.raceId, raceName: s.raceName, horseId: s.horseId, horseName: s.horseName });
          }
        }
      }

      if (affectedSelections.length === 0) {
        // skip notifying this user by email/notification
        continue;
      }

      // Compose a concise message that only contains the updated selection(s)
      const lines = affectedSelections.map(a => `Race: ${a.raceName || a.raceId} — Scratched: ${a.horseName || a.horseId}`);
      const personalMessage = `Your updated selection(s):\n\n${lines.join('\n')}`;

      insertNotes.push({
        user_id: p.id,
        race_id: marketId,
        race_name: affectedSelections.map(a => a.raceName).filter(Boolean).join(', ') || `Market ${marketId}`,
        course: '',
        notification_type: 'race_scratched',
        message: personalMessage,
      });

      if (resend) {
        const html = `<p>${lines.map(l => `${l}`).join('<br/>')}</p><p>Please update your selection if you want to change it.</p>`;
        emailsToSend.push({ to: p.email, html, subject: `${subjectBase} — updated selection` });
      }
    }

    // Insert notifications (non-blocking errors)
    try {
      if (insertNotes.length) await supabase.from('notifications').insert(insertNotes);
    } catch (e) {
      console.warn('notifications insert error', e);
    }

    if (resend && emailsToSend.length) {
      const uniqueByTo = emailsToSend.reduce((acc: any, cur) => {
        acc[cur.to] = cur; // last one wins (there should be one per user)
        return acc;
      }, {} as Record<string, { to: string; html: string; subject: string }>);

      const sendPromises = Object.values(uniqueByTo).map(e => resend.emails.send({ from: resendFromEmail, to: e.to, subject: e.subject, html: e.html }));
      const results = await Promise.allSettled(sendPromises);
      sentCount = results.filter(r => r.status === 'fulfilled').length;
    }

    return NextResponse.json({ success: true, scratched: scratched.map((s) => ({ id: s.id, name: s.name })), notified: insertNotes.length, emailsSent: sentCount });
  } catch (err) {
    console.error('notify-scratches error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
