import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return Response.json({ error: 'Supabase env missing' }, { status: 500 });

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.slice(7).trim();

    const sup = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userRes, error: authErr } = await sup.auth.getUser(token);
    const user = (userRes as any)?.user;
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await sup.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile || !profile.is_admin) return Response.json({ error: 'Admin only' }, { status: 403 });

    // fetch pending payments
    const { data: payments, error } = await sup.from('payments').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(200);
    if (error) return Response.json({ error: 'Failed to fetch payments' }, { status: 500 });

    // fetch simple profile info for involved users
    const userIds = Array.from(new Set((payments || []).map((p: any) => p.user_id))).filter(Boolean);
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: profs } = await sup.from('profiles').select('id,username,email').in('id', userIds);
      profiles = profs || [];
    }

    const mapped = (payments || []).map((p: any) => ({ payment: p, profile: profiles.find((r) => r.id === p.user_id) }));
    return Response.json({ pending: mapped });
  } catch (err) {
    console.error('Admin payments list error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
