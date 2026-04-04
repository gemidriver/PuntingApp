import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const raceIds: string[] = Array.isArray(body?.raceIds) ? body.raceIds : [];

    if (!raceIds.length) return Response.json({ success: true, message: 'No races to notify.' });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return Response.json({ error: 'Missing Supabase config' }, { status: 500 });

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const accessToken = authHeader.slice(7);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (ownProfileError || !ownProfile?.is_admin) return Response.json({ error: 'Admin access required' }, { status: 403 });

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    const canSendEmail = Boolean(resendApiKey && resendFromEmail);
    const resend = canSendEmail ? new Resend(resendApiKey) : null;

    // Load race_results for these races (1..3)
    const { data: resultRows, error: resErr } = await supabase
      .from('race_results')
      .select('meet_id,race_id,horse_id,horse_name,finishing_position')
      .in('race_id', raceIds)
      .in('finishing_position', [1, 2, 3]);

    if (resErr) return Response.json({ error: 'Failed to load race results' }, { status: 500 });

    // group results by race
    const byRace: Record<string, any[]> = {};
    (resultRows || []).forEach((r: any) => {
      if (!r?.race_id) return;
      byRace[r.race_id] = byRace[r.race_id] || [];
      byRace[r.race_id].push(r);
    });

    let totalNotifs = 0;
    let totalEmails = 0;

    for (const raceId of Object.keys(byRace)) {
      const rows = byRace[raceId];
      const winner = rows.find((r: any) => r.finishing_position === 1);
      const second = rows.find((r: any) => r.finishing_position === 2);
      const third = rows.find((r: any) => r.finishing_position === 3);
      const resultMessage = `Results: Winner: ${winner?.horse_name || winner?.horse_id || 'N/A'}${second?.horse_name ? `, 2nd: ${second.horse_name}` : ''}${third?.horse_name ? `, 3rd: ${third.horse_name}` : ''}`;

      // determine meet id
      const meetId = rows[0]?.meet_id;

      // find users who submitted for this meet
      const { data: allSubs } = await supabase.from('user_submissions').select('user_id,selections').eq('submitted', true);
      const notifyUserIds = new Set<string>();
      for (const s of (allSubs || [])) {
        try {
          const sels = Array.isArray(s.selections) ? s.selections : [];
          if (sels.find((x: any) => String(x?.meetId || '') === String(meetId))) {
            if (s.user_id) notifyUserIds.add(String(s.user_id));
          }
        } catch (e) {
          // ignore
        }
      }

      if (!notifyUserIds.size) continue;

      const { data: profilesToNotify, error: profErr } = await supabase
        .from('profiles')
        .select('id,email,username')
        .in('id', [...notifyUserIds]);

      if (profErr || !Array.isArray(profilesToNotify) || !profilesToNotify.length) continue;

      const payload = profilesToNotify.map((user: any) => ({
        user_id: user.id,
        race_id: raceId,
        race_name: raceId,
        course: '',
        notification_type: 'race_results',
        message: resultMessage,
        read_at: null,
      }));

      try {
        const { error: notifErr } = await supabase.from('notifications').upsert(payload, { onConflict: 'user_id,race_id,notification_type' });
        if (!notifErr) totalNotifs += payload.length;
      } catch (e) {
        console.error('Failed upserting manual result notifications', e);
      }

      if (canSendEmail && resend) {
        try {
          const emails = (profilesToNotify || []).map((u: any) => String(u.email || '')).filter(Boolean);
          const unique = [...new Set(emails)];
          const subject = `Updated Results: ${raceId}`;
          const html = `<p>${resultMessage}</p><p>Manual results have been saved and scores updated.</p>`;
          const sendPromises = unique.map((to) => resend.emails.send({ from: resendFromEmail, to, subject, html }));
          const results = await Promise.allSettled(sendPromises);
          totalEmails += results.filter((r) => r.status === 'fulfilled').length;
        } catch (e) {
          console.error('Failed sending manual result emails', e);
        }
      }
    }

    return Response.json({ success: true, notificationsCreated: totalNotifs, emailsSent: totalEmails });
  } catch (error) {
    console.error('manual-placings notify error:', error);
    return Response.json({ error: 'Failed to notify manual placings' }, { status: 500 });
  }
}
