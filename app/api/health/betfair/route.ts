import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runBetfairHealthCheck } from '../../../../lib/betfair';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);

  try {
    const result = await runBetfairHealthCheck(date);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        date,
        error: (error as Error).message ?? 'Betfair health check failed',
      },
      { status: 500 }
    );
  }
}
