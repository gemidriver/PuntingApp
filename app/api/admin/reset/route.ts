import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const nextGlobalMeets = Array.isArray(body?.nextGlobalMeets) ? body.nextGlobalMeets : [];

    const supabase = getSupabaseAdminClient();

    // NOTE: Do not clear the historical `race_results` table here.
    // Historical results are preserved in `race_results` and `round_history`.

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

    // Clear all user eligibilities so jackpot resets to $0 for the new round
    const { error: eligibilitiesError } = await supabase
      .from('user_eligibilities')
      .delete()
      .not('user_id', 'is', null);

    if (eligibilitiesError) {
      console.error(eligibilitiesError);
      return NextResponse.json({ error: 'Unable to reset user eligibilities' }, { status: 500 });
    }

    // Mark any previously active race_meets rows as closed
    await supabase
      .from('race_meets')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('status', 'active');

    // Insert race_meets rows for the newly published meets (if any)
    if (nextGlobalMeets.length) {
      const now = new Date().toISOString();
      const meetRows = nextGlobalMeets.map((meet: any) => ({
        meet_id: meet.meet_id,
        course: meet.course || meet.meet_id,
        race_date: meet.date || now.slice(0, 10),
        race_type: meet.raceType || null,
        state: meet.state || null,
        published_at: now,
        status: 'active',
        meta: { meet_id: meet.meet_id, course: meet.course, date: meet.date, raceType: meet.raceType, state: meet.state },
      }));
      const { error: raceMeetsError } = await supabase
        .from('race_meets')
        .insert(meetRows);
      if (raceMeetsError) {
        // Non-fatal: log but don't block the reset
        console.error('Failed to insert race_meets rows:', raceMeetsError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message || 'Unknown error' }, { status: 500 });
  }
}
