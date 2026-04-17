import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { fetchMarketRunners } from '../../../lib/theracingapi';

export const preferredRegion = 'syd1';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get('marketId');

  if (!marketId) {
    return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
  }

  try {
    // Fetch with status so the UI can show scratched (REMOVED) horses with strikethrough.
    // We keep them in the list but the UI disables them so they can't be selected.
    const runners = await fetchMarketRunners(marketId, true);
    return NextResponse.json({ marketId, runners });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? 'Failed to fetch market runners' },
      { status: 500 }
    );
  }
}
