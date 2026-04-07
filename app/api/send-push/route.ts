import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';

webpush.setVapidDetails(
  'mailto:admin@thetoppunter.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// POST /api/send-push
// Body: { title, body, url?, userIds? }
// If userIds is omitted, broadcasts to all subscribers.

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { title, body, url, userIds } = await req.json() as {
      title: string;
      body: string;
      url?: string;
      userIds?: string[];
    };

    const admin = getSupabaseAdminClient();
    let query = admin.from('push_subscriptions').select('endpoint, p256dh, auth');
    if (userIds && userIds.length > 0) {
      query = query.in('user_id', userIds);
    }
    const { data: subs, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const payload = JSON.stringify({ title, body, url: url ?? '/' });
    const results = await Promise.allSettled(
      (subs ?? []).map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    // Clean up expired subscriptions (410 Gone)
    const expired = (subs ?? []).filter((_, i) => {
      const r = results[i];
      return r.status === 'rejected' && (r.reason as { statusCode?: number })?.statusCode === 410;
    });
    if (expired.length > 0) {
      await admin.from('push_subscriptions').delete().in('endpoint', expired.map((s) => s.endpoint));
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
