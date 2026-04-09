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

    // fetch all profiles (so we can show "not entered" users too)
    const { data: allProfiles } = await sup.from('profiles').select('id,username,email').order('username', { ascending: true });
    const profiles: any[] = allProfiles || [];
    const allUserIds = profiles.map((p: any) => p.id);

    // fetch all submissions (any status) for these users
    let submissions: any[] = [];
    if (allUserIds.length) {
      const { data: subs } = await sup.from('user_submissions').select('*').in('user_id', allUserIds).order('submitted_at', { ascending: false });
      submissions = subs || [];
    }

    // fetch eligibilities (optionally filtered by meetId)
    let eligibilities: any[] = [];
    if (allUserIds.length) {
      let q = sup.from('user_eligibilities').select('*').in('user_id', allUserIds);
      if (meetId) q = q.eq('meet_id', meetId);
      const { data: el } = await q;
      eligibilities = el || [];
    }

    // fetch payments (filter by meet if provided)
    let payments: any[] = [];
    if (allUserIds.length) {
      let q = sup.from('payments').select('*').in('user_id', allUserIds);
      if (meetId) q = q.eq('meet_id', meetId);
      const { data: p } = await q;
      payments = p || [];
    }

    // map one row per profile
    const mapped = profiles.map((prof: any) => {
      const sub = submissions.find((s: any) => s.user_id === prof.id) || null;
      const elig = eligibilities.find((e: any) => e.user_id === prof.id && (!meetId || e.meet_id === meetId)) || null;
      const userPayments = payments.filter((p: any) => p.user_id === prof.id && (!meetId || p.meet_id === meetId));
      const total = userPayments.reduce((acc: number, cur: any) => acc + Number(cur.amount || 0), 0);
      const confirmed = userPayments.reduce((acc: number, cur: any) => acc + (cur.status === 'confirmed' ? Number(cur.amount || 0) : 0), 0);
      return { submission: sub, profile: prof, eligibility: elig, payments: { total, confirmed, raw: userPayments } };
    });

    return Response.json({ pending: mapped });
  } catch (err) {
    console.error('Admin submissions list error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
