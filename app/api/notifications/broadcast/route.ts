import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const { notification_type, message } = body;
    if (!notification_type || !message) {
      return Response.json({ error: 'notification_type and message required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const accessToken = authHeader.slice(7);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return Response.json({ error: 'Supabase env missing' }, { status: 500 });

    const client = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: { user }, error: authError } = await client.auth.getUser(accessToken);
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ensure admin
    const { data: profile } = await client.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return Response.json({ error: 'Admin required' }, { status: 403 });

    // fetch all users
    const admin = getSupabaseAdminClient();
    const { data: profiles } = await admin.from('profiles').select('id');
    const recipients = Array.isArray(profiles) ? profiles.map((p: any) => String(p.id)) : [];
    if (!recipients.length) return Response.json({ success: true, created: 0 });

    const payload = recipients.map((id: string) => ({
      user_id: id,
      race_id: 'meet',
      race_name: 'Meet update',
      course: 'Meet',
      notification_type,
      message,
      read_at: null,
    }));

    await admin.from('notifications').upsert(payload, { onConflict: 'user_id,race_id,notification_type' });

    return Response.json({ success: true, created: payload.length });
  } catch (err) {
    console.error('broadcast notifications error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
