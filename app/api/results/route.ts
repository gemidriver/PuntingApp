import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMarketResults } from '../../../lib/theracingapi';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { marketIds?: string[] };
    const marketIds = body.marketIds ?? [];
    if (!marketIds.length) {
      return NextResponse.json({ error: 'marketIds required' }, { status: 400 });
    }
    const results = await fetchMarketResults(marketIds);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to fetch Betfair results at /api/results' },
      { status: 500 }
    );
  }
}
