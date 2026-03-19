import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchRacesForCourse } from '../../../lib/theracingapi';

export const preferredRegion = 'syd1';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const courseId = searchParams.get('courseId');
  const debug = searchParams.get('debug') === 'true';

  console.log('API /races: called with courseId=', courseId, 'date=', date);

  if (!courseId) {
    return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
  }

  try {
    const data = await fetchRacesForCourse(courseId, date, debug);
    console.log('API /races: success for courseId=', courseId, 'returned', data.races?.length || 0, 'races');
    return NextResponse.json(data);
  } catch (error) {
    console.error('API /races: error for courseId=', courseId, 'error=', error);
    return NextResponse.json(
      { error: (error as Error).message ?? 'Failed to fetch races' },
      { status: 500 }
    );
  }
}
