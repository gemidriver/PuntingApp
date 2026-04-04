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

    const subject = `Scratch update for market ${marketId}`;
    const scratchNames = scratched.map((s) => s.name).join(', ');
    const message = `Scratched runner(s): ${scratchNames}`;

    const recipients = (profiles || []).filter((p: any) => p?.email).map((p: any) => ({ id: p.id, email: p.email }));

    // Create in-app notifications and optionally send emails
    const insertNotes = [] as any[];
    for (const r of recipients) {
      insertNotes.push({
        user_id: r.id,
        race_id: marketId,
        race_name: `Market ${marketId}`,
        course: '',
        notification_type: 'race_scratched',
        message,
      });
    }

    // Insert notifications (non-blocking errors)
    try {
      await supabase.from('notifications').insert(insertNotes);
    } catch (e) {
      // ignore individual insert errors
      console.warn('notifications insert error', e);
    }

    let sentCount = 0;
    if (resend) {
      const emails = recipients.map((r: any) => r.email).filter(Boolean);
      const unique = [...new Set(emails)];
      const sendPromises = unique.map((to) =>
        resend.emails.send({ from: resendFromEmail, to, subject, html: `<p>${message}</p>` })
      );
      const results = await Promise.allSettled(sendPromises);
      sentCount = results.filter((r) => r.status === 'fulfilled').length;
    }

    return NextResponse.json({ success: true, scratched: scratched.map((s) => ({ id: s.id, name: s.name })), notified: recipients.length, emailsSent: sentCount });
  } catch (err) {
    console.error('notify-scratches error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
