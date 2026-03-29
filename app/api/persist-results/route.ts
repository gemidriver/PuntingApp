import { createClient } from '@supabase/supabase-js';
import { fetchMarketResults } from '../../../lib/theracingapi';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as { marketIds?: string[] }));
    const marketIds = Array.isArray(body.marketIds) ? body.marketIds : [];
    if (!marketIds.length) return Response.json({ error: 'marketIds required' }, { status: 400 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return Response.json({ error: 'Supabase environment variables are missing.' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.slice(7).trim();
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ensure admin
    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return Response.json({ error: 'Admin required' }, { status: 403 });

    // fetch results from Betfair/theracingapi
    const fetched = await fetchMarketResults(marketIds);
    if (!Array.isArray(fetched)) return Response.json({ error: 'Failed to fetch results' }, { status: 500 });

    // build map of race results
    const map: Record<string, any> = {};
    fetched.forEach((r: any) => {
      if (!r.marketId || !r.winnerId) return;
      const existing = map[r.marketId] || { winnerId: '', winnerName: null, secondId: null, secondName: null, thirdId: null, thirdName: null };
      map[r.marketId] = {
        ...existing,
        winnerId: r.winnerId,
        winnerName: r.winnerName || null,
        secondId: r.secondId || existing.secondId || null,
        secondName: r.secondName || existing.secondName || null,
        thirdId: r.thirdId || existing.thirdId || null,
        thirdName: r.thirdName || existing.thirdName || null,
      };
    });

    // try to resolve meet_id for each marketId via user_submissions selections
    const { data: subsAll } = await supabase.from('user_submissions').select('selections');

    const raceIdToMeet: Record<string, string | null> = {};
    (subsAll || []).forEach((row: any) => {
      const sels = Array.isArray(row.selections) ? row.selections : [];
      sels.forEach((s: any) => {
        if (s?.raceId && marketIds.includes(s.raceId) && s.meetId) {
          raceIdToMeet[s.raceId] = s.meetId;
        }
      });
    });

    // build rows to insert
    const rows: any[] = [];
    for (const raceId of marketIds) {
      const res = map[raceId];
      const meetId = raceIdToMeet[raceId] || null;
      if (!res || !meetId) continue;
      rows.push({ meet_id: meetId, race_id: raceId, horse_id: res.winnerId, horse_name: res.winnerName ?? null, finishing_position: 1, result_date: new Date().toISOString() });
      if (res.secondId) rows.push({ meet_id: meetId, race_id: raceId, horse_id: res.secondId, horse_name: res.secondName ?? null, finishing_position: 2, result_date: new Date().toISOString() });
      if (res.thirdId) rows.push({ meet_id: meetId, race_id: raceId, horse_id: res.thirdId, horse_name: res.thirdName ?? null, finishing_position: 3, result_date: new Date().toISOString() });
    }

    if (!rows.length) return Response.json({ success: true, inserted: 0 });

    const { error: upsertError } = await supabase.from('race_results').upsert(rows, { onConflict: 'meet_id,race_id,horse_id' });
    if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

    return Response.json({ success: true, inserted: rows.length });
  } catch (err) {
    console.error('persist-results error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
