import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMarketRunners } from '../../../lib/theracingapi';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get('marketId');

  if (!marketId) {
    return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
  }

  try {
    const runners = await fetchMarketRunners(marketId);
    return NextResponse.json({ marketId, runners });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? 'Failed to fetch market runners' },
      { status: 500 }
    );
  }
}
