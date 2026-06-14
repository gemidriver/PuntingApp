import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isPlaceholderRunnerName, fetchRacesForCourse } from '../../../lib/betfair';
import { getSupabaseServiceClient } from '../../../lib/supabase-server';

export const preferredRegion = 'syd1';

const RACE_RUNNERS_SETTING_KEY = 'race_runners';

type StoredRunner = { horseId: string; horseName: string };
type RaceRunnersMap = Record<string, StoredRunner[]>;

async function persistRealRunnerNames(races: Awaited<ReturnType<typeof fetchRacesForCourse>>['races']) {
  const client = getSupabaseServiceClient();
  if (!client) return;

  const patch: RaceRunnersMap = {};
  for (const race of races) {
    const real = race.runners.filter(r => !isPlaceholderRunnerName(r.name));
    if (real.length > 0) {
      patch[race.id] = real.map(r => ({ horseId: r.id, horseName: r.name }));
    }
  }
  if (!Object.keys(patch).length) return;

  const { data } = await client
    .from('app_settings')
    .select('value')
    .eq('key', RACE_RUNNERS_SETTING_KEY)
    .maybeSingle();

  const existing = (data?.value ?? {}) as RaceRunnersMap;
  const merged = { ...existing };
  for (const [raceId, runners] of Object.entries(patch)) {
    const prev = new Map((merged[raceId] ?? []).map(r => [r.horseId, r.horseName]));
    for (const r of runners) {
      prev.set(r.horseId, r.horseName);
    }
    merged[raceId] = [...prev.entries()].map(([horseId, horseName]) => ({ horseId, horseName }));
  }

  await client
    .from('app_settings')
    .upsert({ key: RACE_RUNNERS_SETTING_KEY, value: merged }, { onConflict: 'key' });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const courseId = searchParams.get('courseId');
  const debug = searchParams.get('debug') === 'true';
  const raceTypeParam = searchParams.get('raceType');
  const raceType = raceTypeParam === 'Harness' || raceTypeParam === 'Thoroughbred' ? raceTypeParam : undefined;

  console.log('API /races: called with courseId=', courseId, 'date=', date);

  if (!courseId) {
    return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
  }

  try {
    const data = await fetchRacesForCourse(courseId, date, debug, raceType);
    console.log('API /races: success for courseId=', courseId, 'returned', data.races?.length || 0, 'races');

    void persistRealRunnerNames(data.races ?? []);

    return NextResponse.json(data);
  } catch (error) {
    console.error('API /races: error for courseId=', courseId, 'error=', error);
    return NextResponse.json(
      { error: (error as Error).message ?? 'Failed to fetch races' },
      { status: 500 }
    );
  }
}
