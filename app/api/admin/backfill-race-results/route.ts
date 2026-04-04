import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';
import { fetchMarketRunners } from '../../../../lib/betfair';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const admin = getSupabaseAdminClient();

    // Find race_results rows missing horse_name
    const { data: missingRows, error: missErr } = await admin
      .from('race_results')
      .select('id,meet_id,race_id,horse_id')
      .is('horse_name', null)
      .limit(5000);

    if (missErr) {
      console.error('Error querying missing race_results rows', missErr);
      return new Response(JSON.stringify({ error: 'Failed to query missing rows' }), { status: 500 });
    }

    const rows = Array.isArray(missingRows) ? missingRows : [];
    const byRace: Record<string, Array<any>> = {};
    for (const r of rows) {
      if (!r?.race_id) continue;
      byRace[r.race_id] = byRace[r.race_id] || [];
      byRace[r.race_id].push(r);
    }

    let updated = 0;
    for (const raceId of Object.keys(byRace)) {
      try {
        const runners = await fetchMarketRunners(raceId);
        const runnerMap: Record<string, string> = {};
        (runners || []).forEach((rr: any) => { if (rr?.id) runnerMap[String(rr.id)] = rr.name || ''; });

        for (const r of byRace[raceId]) {
          const name = runnerMap[String(r.horse_id)];
          if (name) {
            const { error: upErr } = await admin.from('race_results').update({ horse_name: name }).eq('id', r.id);
            if (!upErr) updated++;
            else console.error('Failed to update race_result id', r.id, upErr);
          }
        }
      } catch (e) {
        console.error('Failed to fetch runners for', raceId, e);
        continue;
      }
    }

    return new Response(JSON.stringify({ success: true, rowsFound: rows.length, updated }), { status: 200 });
  } catch (err) {
    console.error('Backfill error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
