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

    const url = new URL(request.url);
    const meetId = url.searchParams.get('meetId') || null;

    // fetch submitted user submissions
    const subQuery = sup.from('user_submissions').select('*').eq('submitted', true).order('submitted_at', { ascending: false });
    const { data: subs } = await subQuery;
    const submissions = Array.isArray(subs) ? subs : [];
    const userIds = Array.from(new Set(submissions.map((s: any) => s.user_id).filter(Boolean)));

    // fetch profiles
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: profs } = await sup.from('profiles').select('id,username,email').in('id', userIds);
      profiles = profs || [];
    }

    // fetch eligibilities for these users (optionally filtered by meetId)
    let eligibilities: any[] = [];
    if (userIds.length) {
      let q = sup.from('user_eligibilities').select('*').in('user_id', userIds);
      if (meetId) q = q.eq('meet_id', meetId);
      const { data: el } = await q;
      eligibilities = el || [];
    }

    // fetch payments for these users (filter by meet if provided)
    let payments: any[] = [];
    if (userIds.length) {
      let q = sup.from('payments').select('*').in('user_id', userIds);
      if (meetId) q = q.eq('meet_id', meetId);
      const { data: p } = await q;
      payments = p || [];
    }

    // map results
    const mapped = submissions.map((s: any) => {
      const prof = profiles.find((p) => p.id === s.user_id) || null;
      const elig = eligibilities.find((e) => e.user_id === s.user_id && (!meetId || e.meet_id === meetId)) || null;
      const userPayments = payments.filter((p: any) => p.user_id === s.user_id && (!meetId || p.meet_id === meetId));
      const total = userPayments.reduce((acc: number, cur: any) => acc + Number(cur.amount || 0), 0);
      const confirmed = userPayments.reduce((acc: number, cur: any) => acc + (cur.status === 'confirmed' ? Number(cur.amount || 0) : 0), 0);
      return { submission: s, profile: prof, eligibility: elig, payments: { total, confirmed, raw: userPayments } };
    });

    return Response.json({ pending: mapped });
  } catch (err) {
    console.error('Admin submissions list error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
