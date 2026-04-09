import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMarketResults, fetchMarketRunners } from '../../../lib/theracingapi';

export const preferredRegion = 'syd1';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId') || '';
    if (!marketId) {
      return NextResponse.json({ error: 'marketId required' }, { status: 400 });
    }

    const runners = await fetchMarketRunners(marketId);
    return NextResponse.json({ marketId, runners });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to fetch market runners at /api/results' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { marketIds?: string[] };
    const marketIds = body.marketIds ?? [];
    if (!marketIds.length) {
      return NextResponse.json({ error: 'marketIds required' }, { status: 400 });
    }
    const results = await fetchMarketResults(marketIds);

    // For markets that have settled winners, fetch runner names in parallel so
    // the client can display real horse names instead of raw Betfair selection IDs.
    const settledMarketIds = results.filter(r => r.winnerId).map(r => r.marketId);
    const runnerNames: Record<string, Record<string, string>> = {};
    if (settledMarketIds.length) {
      await Promise.allSettled(
        settledMarketIds.map(async (mId) => {
          try {
            const runners = await fetchMarketRunners(mId);
            const nameMap: Record<string, string> = {};
            for (const runner of runners) {
              if (runner.id && runner.name) {
                nameMap[runner.id] = runner.name;
              }
            }
            if (Object.keys(nameMap).length) {
              runnerNames[mId] = nameMap;
            }
          } catch {
            // best-effort — skip on error
          }
        })
      );
    }

    return NextResponse.json({ results, runnerNames });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to fetch Betfair results at /api/results' },
      { status: 500 }
    );
  }
}
