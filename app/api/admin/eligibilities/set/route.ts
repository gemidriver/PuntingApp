import { createClient } from '@supabase/supabase-js';

export async function PATCH(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return Response.json({ error: 'Supabase env missing' }, { status: 500 });

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.slice(7).trim();

    const sup = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    let user: any = null;
    try {
      const { data: userRes, error: authErr } = await sup.auth.getUser();
      if (authErr) {
        console.error('sup.auth.getUser error', authErr);
      }
      user = (userRes as any)?.user ?? null;
    } catch (e) {
      console.error('sup.auth.getUser threw', e);
    }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await sup.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile || !profile.is_admin) return Response.json({ error: 'Admin only' }, { status: 403 });

    const body = await request.json().catch(() => ({} as any));
    console.log('Admin eligibilities.set body', body);
    const userId = body.userId;
    const meetId = body.meetId || null;
    const eligible = Boolean(body.eligible);

    if (!userId || !meetId) return Response.json({ error: 'userId and meetId required' }, { status: 400 });

    const upsertRow = { user_id: userId, meet_id: meetId, eligible, confirmed_at: eligible ? new Date().toISOString() : null, confirmed_by: eligible ? user.id : null };
    const { data: upsertData, error: upsertErr } = await sup.from('user_eligibilities').upsert(upsertRow, { onConflict: 'user_id,meet_id' });
    if (upsertErr) {
      console.error('user_eligibilities upsert error', upsertErr, 'payload', upsertRow, 'result', upsertData);
      return Response.json({ error: 'Failed to upsert eligibility', details: upsertErr.message ?? String(upsertErr) }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Admin eligibilities set error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
