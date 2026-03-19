import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMeets } from '../../../lib/theracingapi';

export const preferredRegion = 'syd1';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);

  try {
    const data = await fetchMeets(date);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? 'Failed to fetch meets' },
      { status: 500 }
    );
  }
}
