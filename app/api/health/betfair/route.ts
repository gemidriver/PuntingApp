import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runBetfairHealthCheck } from '../../../../lib/betfair';

export const preferredRegion = 'syd1';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const appKeyConfigured = Boolean(process.env.BETFAIR_APP_KEY);
  const sessionTokenConfigured = Boolean(process.env.BETFAIR_SESSION_TOKEN);

  try {
    const result = await runBetfairHealthCheck(date);
    return NextResponse.json(result);
  } catch (error) {
    const missingVars: string[] = [];
    if (!appKeyConfigured) missingVars.push('BETFAIR_APP_KEY');
    if (!sessionTokenConfigured) missingVars.push('BETFAIR_SESSION_TOKEN');

    return NextResponse.json(
      {
        ok: false,
        date,
        env: {
          appKeyConfigured,
          sessionTokenConfigured,
        },
        envMissing: missingVars,
        error: (error as Error).message ?? 'Betfair health check failed',
      },
      { status: 500 }
    );
  }
}
