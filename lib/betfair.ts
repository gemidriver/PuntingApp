export interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
}

export interface Race {
  id: string;
  name: string;
  time: string;
  courseId: string;
  runners: {
    id: string;
    name: string;
    number: number;
    odds: string;
    jockey: string;
    trainer: string;
    weight: string;
    age: string;
    form: string;
    colours: string;
  }[];
}

export interface RaceResult {
  marketId: string;
  winnerId: string | null;
  settled: boolean;
}

export interface MarketRunner {
  id: string;
  name: string;
  number: number | null;
}

export interface BetfairHealthCheckResult {
  ok: boolean;
  date: string;
  env: {
    appKeyConfigured: boolean;
    sessionTokenConfigured: boolean;
  };
  checks: {
    eventTypeCount: number;
    competitionCount: number;
    marketCount: number;
    marketWithCompetitionCount: number;
    marketWithEventCount: number;
  };
  samples: {
    firstCompetition: { id: string; name: string } | null;
    firstMarket: {
      marketId: string;
      marketName: string;
      competitionId: string | null;
      competitionName: string | null;
      eventId: string | null;
      eventName: string | null;
    } | null;
  };
}

type BetfairRunnerDescription = {
  selectionId?: number;
  runnerName?: string;
  sortPriority?: number;
};

type BetfairMarketCatalogue = {
  marketId?: string;
  marketName?: string;
  marketStartTime?: string;
  event?: {
    id?: string;
    name?: string;
  };
  competition?: {
    id?: string;
    name?: string;
  };
  description?: {
    raceType?: string;
  };
  runners?: BetfairRunnerDescription[];
};

type BetfairMarketBook = {
  marketId?: string;
  status?: string;
  runners?: Array<{
    selectionId?: number;
    status?: string;
    ex?: {
      availableToBack?: Array<{ price?: number }>;
    };
    lastPriceTraded?: number;
  }>;
};

type BetfairRpcEnvelope<T> = {
  result?: T;
  error?: BetfairRpcError;
};

type BetfairRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

const BETFAIR_BETTING_API_URL =
  process.env.BETFAIR_BETTING_API_URL ?? 'https://api-au.betfair.com/exchange/betting/json-rpc/v1';
const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY;
const BETFAIR_SESSION_TOKEN = process.env.BETFAIR_SESSION_TOKEN;

function requireBetfairAppKey() {
  if (!BETFAIR_APP_KEY) {
    throw new Error('BETFAIR_APP_KEY is not configured. Add it to .env.local and restart the app.');
  }
}

function toIsoDateWindow(date: string) {
  const normalized = `${date.slice(0, 10)}T00:00:00.000Z`;
  const from = new Date(normalized);
  if (Number.isNaN(from.getTime())) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD.');
  }
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function formatBetfairError(error: BetfairRpcError, fallbackMessage: string) {
  const base = error.message || fallbackMessage;
  const dataText = typeof error.data === 'string' ? error.data : '';
  const message = `${base}${dataText ? ` (${dataText})` : ''}`;

  if (/INVALID_SESSION_INFORMATION|NO_SESSION/i.test(message)) {
    return `${message}. Set BETFAIR_SESSION_TOKEN in .env.local with a valid SSOID/session token and restart.`;
  }

  if (/ANGX-0003/i.test(message)) {
    return `${message}. This usually means the Betfair session token is invalid or expired. Refresh BETFAIR_SESSION_TOKEN and restart.`;
  }

  if (/INVALID_APP_KEY/i.test(message)) {
    return `${message}. Verify BETFAIR_APP_KEY is correct and active for your account.`;
  }

  return message;
}

async function betfairRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  requireBetfairAppKey();

  const requestBody = {
    jsonrpc: '2.0',
    method: `SportsAPING/v1.0/${method}`,
    params,
    id: 1,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Application': BETFAIR_APP_KEY as string,
  };

  if (BETFAIR_SESSION_TOKEN) {
    headers['X-Authentication'] = BETFAIR_SESSION_TOKEN;
  }

  const response = await fetch(BETFAIR_BETTING_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  let payload: BetfairRpcEnvelope<T> | BetfairRpcEnvelope<T>[] | null = null;
  let parseError: Error | null = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as BetfairRpcEnvelope<T> | BetfairRpcEnvelope<T>[];
    } catch (error) {
      parseError = error as Error;
    }
  }

  const preview = rawText.slice(0, 180).replace(/\s+/g, ' ').trim();

  if (!response.ok) {
    const rpcError = Array.isArray(payload) ? payload[0]?.error : payload?.error;
    const statusMessage = rpcError?.message || preview || 'Betfair request failed';
    throw new Error(
      `Betfair HTTP ${response.status} (${contentType || 'unknown content-type'}): ${statusMessage}`
    );
  }

  if (parseError || !payload) {
    throw new Error(
      `Betfair returned a non-JSON response (${response.status}, ${contentType || 'unknown content-type'}). ` +
      `Preview: ${preview || '[empty response]'}. This usually indicates a cloud egress/routing block or upstream HTML challenge page.`
    );
  }

  const rpcEnvelope = Array.isArray(payload) ? payload[0] : payload;
  if (rpcEnvelope?.error) {
    throw new Error(formatBetfairError(rpcEnvelope.error as BetfairRpcError, 'Betfair RPC error'));
  }

  return rpcEnvelope?.result as T;
}

async function listMarketCatalogue(params: Record<string, unknown>): Promise<BetfairMarketCatalogue[]> {
  const result = await betfairRpc<BetfairMarketCatalogue[]>('listMarketCatalogue', params);
  return Array.isArray(result) ? result : [];
}

async function listMarketBook(params: Record<string, unknown>): Promise<BetfairMarketBook[]> {
  const result = await betfairRpc<BetfairMarketBook[]>('listMarketBook', params);
  return Array.isArray(result) ? result : [];
}

function isThoroughbredMarket(market: BetfairMarketCatalogue): boolean {
  const raceType = String(market.description?.raceType ?? '').toLowerCase();
  const marketName = String(market.marketName ?? '').toLowerCase();
  const eventName = String(market.event?.name ?? '').toLowerCase();
  const competitionName = String(market.competition?.name ?? '').toLowerCase();
  const combined = `${marketName} ${eventName} ${competitionName}`;

  // Betfair can expose harness metadata either in description.raceType or market/event naming.
  if (raceType.includes('harness')) return false;
  if (raceType.includes('trot')) return false;
  if (raceType.includes('pace')) return false;

  if (/\bpace\b/.test(combined)) return false;
  if (/\btrot\b/.test(combined)) return false;
  if (/\bharness\b/.test(combined)) return false;

  return true;
}

export async function runBetfairHealthCheck(date: string): Promise<BetfairHealthCheckResult> {
  const window = toIsoDateWindow(date);

  const eventTypes = await betfairRpc<Array<{ eventType?: { id?: string; name?: string } }>>(
    'listEventTypes',
    {
      filter: {},
    }
  );

  const competitions = await betfairRpc<Array<{ competition?: { id?: string; name?: string } }>>(
    'listCompetitions',
    {
      filter: {
        eventTypeIds: ['7'],
        marketCountries: ['AU'],
        marketStartTime: {
          from: window.from,
          to: window.to,
        },
      },
    }
  );

  const markets = await listMarketCatalogue({
    filter: {
      eventTypeIds: ['7'],
      marketCountries: ['AU'],
      marketTypeCodes: ['WIN'],
      marketStartTime: {
        from: window.from,
        to: window.to,
      },
    },
    marketProjection: ['COMPETITION', 'EVENT', 'MARKET_DESCRIPTION'],
    sort: 'FIRST_TO_START',
    maxResults: '200',
  });

  const filteredMarkets = markets.filter(isThoroughbredMarket);

  const firstCompetition = competitions[0]?.competition;
  const firstMarket = filteredMarkets[0] ?? markets[0];
  const marketWithCompetitionCount = filteredMarkets.filter((m) => Boolean(m.competition?.id)).length;
  const marketWithEventCount = filteredMarkets.filter((m) => Boolean(m.event?.id)).length;

  return {
    ok: true,
    date,
    env: {
      appKeyConfigured: Boolean(BETFAIR_APP_KEY),
      sessionTokenConfigured: Boolean(BETFAIR_SESSION_TOKEN),
    },
    checks: {
      eventTypeCount: Array.isArray(eventTypes) ? eventTypes.length : 0,
      competitionCount: Array.isArray(competitions) ? competitions.length : 0,
      marketCount: filteredMarkets.length,
      marketWithCompetitionCount,
      marketWithEventCount,
    },
    samples: {
      firstCompetition: firstCompetition
        ? {
            id: String(firstCompetition.id ?? ''),
            name: String(firstCompetition.name ?? ''),
          }
        : null,
      firstMarket: firstMarket
        ? {
            marketId: String(firstMarket.marketId ?? ''),
            marketName: String(firstMarket.marketName ?? ''),
            competitionId: firstMarket.competition?.id ? String(firstMarket.competition.id) : null,
            competitionName: firstMarket.competition?.name ? String(firstMarket.competition.name) : null,
            eventId: firstMarket.event?.id ? String(firstMarket.event.id) : null,
            eventName: firstMarket.event?.name ? String(firstMarket.event.name) : null,
          }
        : null,
    },
  };
}

export async function fetchMeets(date: string): Promise<{ meets: Meet[] }> {
  const window = toIsoDateWindow(date);
  const markets = await listMarketCatalogue({
    filter: {
      eventTypeIds: ['7'],
      marketCountries: ['AU'],
      marketTypeCodes: ['WIN'],
      marketStartTime: {
        from: window.from,
        to: window.to,
      },
    },
    marketProjection: ['COMPETITION', 'EVENT', 'MARKET_DESCRIPTION'],
    sort: 'FIRST_TO_START',
    maxResults: '1000',
  });

  const filteredMarkets = markets.filter(isThoroughbredMarket);

  const competitionMap = new Map<string, string>();
  const eventMap = new Map<string, string>();

  for (const market of filteredMarkets) {
    const id = String(market.competition?.id ?? '').trim();
    const name = String(market.competition?.name ?? '').trim();
    if (!id || !name || competitionMap.has(id)) {
      const eventId = String(market.event?.id ?? '').trim();
      const eventName = String(market.event?.name ?? '').trim();
      if (eventId && eventName && !eventMap.has(eventId)) {
        eventMap.set(eventId, eventName);
      }
      continue;
    }
    competitionMap.set(id, name);
  }

  const meetEntries = competitionMap.size
    ? [...competitionMap.entries()].map(([id, name]) => ({ id, name }))
    : [...eventMap.entries()].map(([id, name]) => ({ id: `event:${id}`, name }));

  const meets: Meet[] = meetEntries
    .map(({ id, name }) => ({
      meet_id: id,
      course: name,
      date,
      state: 'AUS',
    }))
    .sort((a, b) => a.course.localeCompare(b.course));

  return { meets };
}

export async function fetchRacesForCourse(
  courseId: string,
  date: string,
  debug = false
): Promise<{ races: Race[]; raw?: unknown }> {
  const trimmedCourseId = String(courseId || '').trim();
  if (!trimmedCourseId) {
    return { races: [] };
  }

  const isEventScoped = trimmedCourseId.startsWith('event:');
  const scopedId = isEventScoped ? trimmedCourseId.slice('event:'.length) : trimmedCourseId;

  const window = toIsoDateWindow(date);
  const markets = await listMarketCatalogue({
    filter: {
      eventTypeIds: ['7'],
      marketCountries: ['AU'],
      marketTypeCodes: ['WIN'],
      ...(isEventScoped ? { eventIds: [scopedId] } : { competitionIds: [scopedId] }),
      marketStartTime: {
        from: window.from,
        to: window.to,
      },
    },
    marketProjection: ['RUNNER_DESCRIPTION', 'MARKET_START_TIME', 'MARKET_DESCRIPTION', 'EVENT'],
    sort: 'FIRST_TO_START',
    maxResults: '200',
  });

  const filteredMarkets = markets.filter(isThoroughbredMarket);

  if (!filteredMarkets.length) {
    return { races: [] };
  }

  const sortedMarkets = [...filteredMarkets].sort((a, b) => {
    const aTs = Date.parse(a.marketStartTime ?? '');
    const bTs = Date.parse(b.marketStartTime ?? '');
    return (Number.isNaN(aTs) ? 0 : aTs) - (Number.isNaN(bTs) ? 0 : bTs);
  });

  const targetMarkets = sortedMarkets.slice(-4);
  const marketIds = targetMarkets
    .map((market) => String(market.marketId ?? '').trim())
    .filter(Boolean);

  const books = marketIds.length
    ? await listMarketBook({
        marketIds,
        priceProjection: {
          priceData: ['EX_BEST_OFFERS'],
        },
      })
    : [];

  const bookMap = new Map<string, BetfairMarketBook>();
  for (const book of books) {
    const id = String(book.marketId ?? '').trim();
    if (id) {
      bookMap.set(id, book);
    }
  }

  const races: Race[] = targetMarkets.map((market, marketIndex) => {
    const raceId = String(market.marketId ?? `${trimmedCourseId}-${marketIndex + 1}`);
    const book = bookMap.get(raceId);
    const bookRunnerMap = new Map<number, NonNullable<BetfairMarketBook['runners']>[number]>();

    for (const bookRunner of book?.runners ?? []) {
      const selectionId = Number(bookRunner.selectionId);
      if (!Number.isNaN(selectionId)) {
        bookRunnerMap.set(selectionId, bookRunner);
      }
    }

    const runners = (market.runners ?? []).map((runner, runnerIndex) => {
      const selectionId = Number(runner.selectionId);
      const bookRunner = bookRunnerMap.get(selectionId);
      const bestBack = bookRunner?.ex?.availableToBack?.[0]?.price;
      const ltp = bookRunner?.lastPriceTraded;
      const oddsValue = typeof bestBack === 'number' ? bestBack : ltp;

      return {
        id: String(runner.selectionId ?? `${raceId}-${runnerIndex + 1}`),
        name: String(runner.runnerName ?? `Runner ${runnerIndex + 1}`),
        number: typeof runner.sortPriority === 'number' ? runner.sortPriority : runnerIndex + 1,
        odds: typeof oddsValue === 'number' ? String(oddsValue) : '',
        jockey: '',
        trainer: '',
        weight: '',
        age: '',
        form: '',
        colours: '',
      };
    });

    return {
      id: raceId,
      name: String(market.marketName ?? `Race ${marketIndex + 1}`),
      time: String(market.marketStartTime ?? ''),
      courseId: trimmedCourseId,
      runners,
    };
  });

  if (debug) {
    return { races, raw: { markets, books } };
  }

  return { races };
}

export async function fetchMarketResults(marketIds: string[]): Promise<RaceResult[]> {
  const ids = marketIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return [];

  const books = await listMarketBook({ marketIds: ids });
  return books
    .filter((book) => Boolean(book.marketId))
    .map((book) => {
      const winner = (book.runners ?? []).find(
        (runner) => String(runner.status ?? '').toUpperCase() === 'WINNER'
      );

      const status = String(book.status ?? '').toUpperCase();

      return {
        marketId: String(book.marketId),
        winnerId: winner?.selectionId ? String(winner.selectionId) : null,
        settled: status === 'CLOSED' || status === 'SETTLED',
      };
    });
}

export async function fetchMarketRunners(marketId: string): Promise<MarketRunner[]> {
  const id = String(marketId || '').trim();
  if (!id) return [];

  const catalogues = await listMarketCatalogue({
    filter: {
      marketIds: [id],
    },
    marketProjection: ['RUNNER_DESCRIPTION'],
    maxResults: '1',
  });

  const market = catalogues[0];
  if (market?.runners?.length) {
    return market.runners
      .map((runner, idx) => ({
        id: String(runner.selectionId ?? ''),
        name: String(runner.runnerName ?? `Runner ${idx + 1}`),
        number: typeof runner.sortPriority === 'number' ? runner.sortPriority : null,
      }))
      .filter((runner) => Boolean(runner.id));
  }

  const books = await listMarketBook({ marketIds: [id] });
  const book = books.find((entry) => String(entry.marketId ?? '') === id);

  return (book?.runners ?? []).map((runner, idx) => ({
    id: String(runner.selectionId ?? ''),
    name: `Runner ${idx + 1}`,
    number: idx + 1,
  }));
}