import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/meet-status?meetId=xxx
 * Returns how many distinct winning race results exist for a meet,
 * and whether the meet is recorded as closed in race_meets.
 * Requires admin auth.
 */
export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase env missing' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.slice(7).trim();

    const sup = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userRes, error: authErr } = await sup.auth.getUser(token);
    const user = (userRes as any)?.user;
    if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await sup.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return Response.json({ error: 'Admin only' }, { status: 403 });

    const url = new URL(request.url);
    const meetId = url.searchParams.get('meetId');
    if (!meetId) return Response.json({ error: 'meetId required' }, { status: 400 });

    // Count distinct winning race results for this meet (finishing_position = 1, one per race)
    const { data: winRows } = await sup
      .from('race_results')
      .select('race_id')
      .eq('meet_id', meetId)
      .eq('finishing_position', 1);

    const winCount = Array.isArray(winRows) ? new Set(winRows.map((r: any) => r.race_id)).size : 0;

    // Check race_meets table for closed status
    const { data: meetRow } = await sup
      .from('race_meets')
      .select('status, closed_at')
      .eq('meet_id', meetId)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return Response.json({
      meetId,
      winCount,
      isClosed: meetRow?.status === 'closed',
      closedAt: meetRow?.closed_at ?? null,
    });
  } catch (err) {
    console.error('meet-status error', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
