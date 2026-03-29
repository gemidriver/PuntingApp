import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const nextGlobalMeets = Array.isArray(body?.nextGlobalMeets) ? body.nextGlobalMeets : [];

    const supabase = getSupabaseAdminClient();

    // Clear race results
    const { error: raceResultsResetError } = await supabase
      .from('race_results')
      .delete()
      .gte('finishing_position', 1);

    if (raceResultsResetError) {
      console.error(raceResultsResetError);
      return NextResponse.json({ error: 'Unable to reset race results' }, { status: 500 });
    }

    // Upsert app settings for global meets and blank runners/results
    const { error: settingsError } = await supabase.from('app_settings').upsert(
      [
        { key: 'global_meets', value: nextGlobalMeets },
        { key: 'race_results', value: {} },
        { key: 'race_runners', value: {} },
      ],
      { onConflict: 'key' }
    );

    if (settingsError) {
      console.error(settingsError);
      return NextResponse.json({ error: 'Unable to update app settings' }, { status: 500 });
    }

    // Clear user submissions for all users
    const { error: submissionsError } = await supabase
      .from('user_submissions')
      .update({ selections: [], wildcard: null, submitted: false, submitted_at: null })
      .not('user_id', 'is', null);

    if (submissionsError) {
      console.error(submissionsError);
      return NextResponse.json({ error: 'Unable to reset user submissions' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message || 'Unknown error' }, { status: 500 });
  }
}
