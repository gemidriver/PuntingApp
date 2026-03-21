export interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
  raceType: 'Thoroughbred' | 'Harness';
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
  secondId?: string | null;
  thirdId?: string | null;
  settled: boolean;
  inferredPlaces?: boolean;
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
  auth: {
    autoLoginConfigured: boolean;
    autoLoginUsedDuringCheck: boolean;
    lastAutoLoginAt: string | null;
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
  metadata?: Record<string, string>;
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
const BETFAIR_PROXY_URL = process.env.BETFAIR_PROXY_URL;
const BETFAIR_PROXY_TOKEN = process.env.BETFAIR_PROXY_TOKEN;
const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY;
const BETFAIR_USERNAME = process.env.BETFAIR_USERNAME;
const BETFAIR_PASSWORD = process.env.BETFAIR_PASSWORD;
const BETFAIR_LOGIN_URL = process.env.BETFAIR_LOGIN_URL ?? 'https://identitysso.betfair.com.au/api/login';

let currentSessionToken = process.env.BETFAIR_SESSION_TOKEN;
let loginPromise: Promise<string> | null = null;
let autoLoginRefreshCount = 0;
let lastAutoLoginAt: string | null = null;

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

function canAutoLogin() {
  return Boolean(BETFAIR_APP_KEY && BETFAIR_USERNAME && BETFAIR_PASSWORD);
}

async function loginBetfairInteractive(): Promise<string> {
  if (!canAutoLogin()) {
    throw new Error(
      'BETFAIR_SESSION_TOKEN is invalid or expired, and automatic refresh is unavailable. Set BETFAIR_USERNAME and BETFAIR_PASSWORD for local auto-login, or refresh BETFAIR_SESSION_TOKEN manually.'
    );
  }

  const body = new URLSearchParams({
    username: BETFAIR_USERNAME as string,
    password: BETFAIR_PASSWORD as string,
  });

  const response = await fetch(BETFAIR_LOGIN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Application': BETFAIR_APP_KEY as string,
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  const preview = rawText.slice(0, 180).replace(/\s+/g, ' ').trim();

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Betfair login returned non-JSON (${response.status}, ${contentType || 'unknown content-type'}). Preview: ${preview || '[empty response]'}`
    );
  }

  const payload = JSON.parse(rawText) as {
    token?: string;
    status?: string;
    error?: string;
    product?: string;
  };

  if (!response.ok || !payload.token || !['SUCCESS', 'LIMITED_ACCESS'].includes(String(payload.status ?? '').toUpperCase())) {
    throw new Error(
      `Betfair login failed (${response.status}): ${payload.status ?? 'UNKNOWN'}${payload.error ? ` - ${payload.error}` : ''}`
    );
  }

  currentSessionToken = payload.token;
  autoLoginRefreshCount += 1;
  lastAutoLoginAt = new Date().toISOString();
  return payload.token;
}

async function ensureFreshSessionToken() {
  if (!loginPromise) {
    loginPromise = loginBetfairInteractive().finally(() => {
      loginPromise = null;
    });
  }

  return loginPromise;
}

async function betfairRpc<T>(method: string, params: Record<string, unknown>, allowRetry = true): Promise<T> {
  requireBetfairAppKey();

  if (BETFAIR_PROXY_URL) {
    const proxyUrl = `${BETFAIR_PROXY_URL.replace(/\/$/, '')}/rpc`;
    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (BETFAIR_PROXY_TOKEN) {
      proxyHeaders['X-Proxy-Token'] = BETFAIR_PROXY_TOKEN;
    }

    const proxyResponse = await fetch(proxyUrl, {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify({ method, params }),
      cache: 'no-store',
    });

    const proxyContentType = proxyResponse.headers.get('content-type') || '';
    const proxyRaw = await proxyResponse.text();
    const proxyPreview = proxyRaw.slice(0, 180).replace(/\s+/g, ' ').trim();

    if (!proxyContentType.includes('application/json')) {
      throw new Error(
        `Betfair proxy returned non-JSON (${proxyResponse.status}, ${proxyContentType || 'unknown content-type'}). Preview: ${proxyPreview || '[empty response]'}`
      );
    }

    const proxyPayload = JSON.parse(proxyRaw) as { result?: T; error?: unknown } | T;
    const wrapped = proxyPayload as { result?: T; error?: unknown };

    if (!proxyResponse.ok || wrapped.error) {
      throw new Error(
        `Betfair proxy error (${proxyResponse.status}): ${String(wrapped.error ?? proxyPreview ?? 'Unknown error')}`
      );
    }

    // Node-RED may return the result unwrapped (direct array/object) or wrapped in { result: T }
    const result = wrapped.result !== undefined ? wrapped.result : (proxyPayload as T);
    return result as T;
  }

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

  if (currentSessionToken) {
    headers['X-Authentication'] = currentSessionToken;
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

    if (allowRetry && /ANGX-0003|INVALID_SESSION_INFORMATION|NO_SESSION/i.test(statusMessage)) {
      await ensureFreshSessionToken();
      return betfairRpc<T>(method, params, false);
    }

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
    if (allowRetry && /ANGX-0003|INVALID_SESSION_INFORMATION|NO_SESSION/i.test(String(rpcEnvelope.error.message ?? ''))) {
      await ensureFreshSessionToken();
      return betfairRpc<T>(method, params, false);
    }
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
  return getMarketRaceType(market) === 'Thoroughbred';
}

function getMarketRaceType(market: BetfairMarketCatalogue): 'Thoroughbred' | 'Harness' {
  const raceType = String(market.description?.raceType ?? '').toLowerCase();
  const marketName = String(market.marketName ?? '').toLowerCase();
  const eventName = String(market.event?.name ?? '').toLowerCase();
  const competitionName = String(market.competition?.name ?? '').toLowerCase();
  const combined = `${marketName} ${eventName} ${competitionName}`;

  // Betfair can expose harness metadata in description.raceType and/or event naming.
  if (raceType.includes('harness')) return 'Harness';
  if (raceType.includes('trot')) return 'Harness';
  if (raceType.includes('pace')) return 'Harness';

  if (/\bpace\b/.test(combined)) return 'Harness';
  if (/\btrot\b/.test(combined)) return 'Harness';
  if (/\bharness\b/.test(combined)) return 'Harness';

  return 'Thoroughbred';
}

export async function runBetfairHealthCheck(date: string): Promise<BetfairHealthCheckResult> {
  const window = toIsoDateWindow(date);
  const refreshCountAtStart = autoLoginRefreshCount;

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
      sessionTokenConfigured: Boolean(currentSessionToken || canAutoLogin()),
    },
    auth: {
      autoLoginConfigured: canAutoLogin(),
      autoLoginUsedDuringCheck: autoLoginRefreshCount > refreshCountAtStart,
      lastAutoLoginAt,
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

  const competitionMap = new Map<string, { name: string; raceType: 'Thoroughbred' | 'Harness' }>();
  const eventMap = new Map<string, { name: string; raceType: 'Thoroughbred' | 'Harness' }>();

  for (const market of markets) {
    const raceType = getMarketRaceType(market);
    const prefix = raceType === 'Harness' ? 'h:' : 't:';

    const id = String(market.competition?.id ?? '').trim();
    const name = String(market.competition?.name ?? '').trim();
    if (!id || !name || competitionMap.has(`${prefix}${id}`)) {
      const eventId = String(market.event?.id ?? '').trim();
      const eventName = String(market.event?.name ?? '').trim();
      const eventKey = `${prefix}event:${eventId}`;
      if (eventId && eventName && !eventMap.has(eventKey)) {
        eventMap.set(eventKey, { name: eventName, raceType });
      }
      continue;
    }
    competitionMap.set(`${prefix}${id}`, { name, raceType });
  }

  const meetEntries = competitionMap.size
    ? [...competitionMap.entries()].map(([id, meta]) => ({ id, ...meta }))
    : [...eventMap.entries()].map(([id, meta]) => ({ id, ...meta }));

  const meets: Meet[] = meetEntries
    .map(({ id, name, raceType }) => ({
      meet_id: id,
      course: name,
      date,
      state: 'AUS',
      raceType,
    }))
    .sort((a, b) => {
      if (a.raceType !== b.raceType) {
        return a.raceType.localeCompare(b.raceType);
      }
      return a.course.localeCompare(b.course);
    });

  return { meets };
}

export async function fetchRacesForCourse(
  courseId: string,
  date: string,
  debug = false,
  raceType?: 'Thoroughbred' | 'Harness'
): Promise<{ races: Race[]; raw?: unknown }> {
  const trimmedCourseId = String(courseId || '').trim();
  if (!trimmedCourseId) {
    return { races: [] };
  }

  let parsedCourseId = trimmedCourseId;
  let meetScopedRaceType: 'Thoroughbred' | 'Harness' | undefined;
  if (trimmedCourseId.startsWith('h:')) {
    meetScopedRaceType = 'Harness';
    parsedCourseId = trimmedCourseId.slice(2);
  } else if (trimmedCourseId.startsWith('t:')) {
    meetScopedRaceType = 'Thoroughbred';
    parsedCourseId = trimmedCourseId.slice(2);
  }

  const desiredRaceType = raceType || meetScopedRaceType || 'Thoroughbred';

  const isEventScoped = parsedCourseId.startsWith('event:');
  const scopedId = isEventScoped ? parsedCourseId.slice('event:'.length) : parsedCourseId;

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

  const filteredMarkets = markets.filter((market) => getMarketRaceType(market) === desiredRaceType);

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
    const raceId = String(market.marketId ?? `${parsedCourseId}-${marketIndex + 1}`);
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
      const metadata = runner.metadata ?? {};

      const firstMeta = (...keys: string[]) => {
        for (const key of keys) {
          const value = String(metadata[key] ?? '').trim();
          if (value) return value;
        }
        return '';
      };
      
      // Use runnerName if available, otherwise try to build from metadata
      let runnerName = String(runner.runnerName || '').trim();
      if (!runnerName) {
        // Fallback: if no runnerName, keep the index-based placeholder but mark it
        // This ensures consistent behavior if Betfair doesn't return the name
        runnerName = `${String(runner.selectionId || `UnknownRunner${runnerIndex + 1}`)}`;
      }

      return {
        id: String(runner.selectionId ?? `${raceId}-${runnerIndex + 1}`),
        name: runnerName,
        number: typeof runner.sortPriority === 'number' ? runner.sortPriority : runnerIndex + 1,
        odds: typeof oddsValue === 'number' ? String(oddsValue) : '',
        jockey: firstMeta('JOCKEY_NAME', 'JOCKEY'),
        trainer: firstMeta('TRAINER_NAME', 'TRAINER'),
        weight: firstMeta('WEIGHT_VALUE', 'WEIGHT', 'WEIGHT_CARRIED'),
        age: firstMeta('AGE'),
        form: firstMeta('FORM'),
        colours: firstMeta('CLOTH_COLOUR', 'COLOURS', 'COLORS', 'SILK_COLOUR'),
      };
    });

    return {
      id: raceId,
      name: String(market.marketName ?? `Race ${marketIndex + 1}`),
      time: String(market.marketStartTime ?? ''),
      courseId: parsedCourseId,
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

  const baseResults = books
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
      } as RaceResult;
    });

  const winnerByMarketId = new Map<string, string>();
  baseResults.forEach((result) => {
    if (result.winnerId) {
      winnerByMarketId.set(result.marketId, result.winnerId);
    }
  });

  const winCatalogues = await listMarketCatalogue({
    filter: {
      marketIds: ids,
    },
    marketProjection: ['EVENT', 'MARKET_START_TIME'],
    maxResults: String(Math.max(1, ids.length)),
  });

  const eventByWinMarketId = new Map<string, string>();
  const eventIds = new Set<string>();
  winCatalogues.forEach((market) => {
    const marketId = String(market.marketId ?? '').trim();
    const eventId = String(market.event?.id ?? '').trim();
    if (marketId && eventId) {
      eventByWinMarketId.set(marketId, eventId);
      eventIds.add(eventId);
    }
  });

  if (!eventIds.size) {
    return baseResults;
  }

  const placeCatalogues = await listMarketCatalogue({
    filter: {
      eventIds: [...eventIds],
      marketTypeCodes: ['PLACE'],
    },
    marketProjection: ['EVENT'],
    sort: 'FIRST_TO_START',
    maxResults: '1000',
  });

  const placeMarketIds = placeCatalogues
    .map((market) => String(market.marketId ?? '').trim())
    .filter(Boolean);

  if (!placeMarketIds.length) {
    return baseResults;
  }

  const placeBooks = await listMarketBook({ marketIds: placeMarketIds });

  const placeWinnersByEvent = new Map<string, Array<Set<string>>>();
  placeBooks.forEach((book) => {
    const marketId = String(book.marketId ?? '').trim();
    if (!marketId) return;

    const catalogue = placeCatalogues.find((m) => String(m.marketId ?? '').trim() === marketId);
    const eventId = String(catalogue?.event?.id ?? '').trim();
    if (!eventId) return;

    const winners = (book.runners ?? [])
      .filter((runner) => String(runner.status ?? '').toUpperCase() === 'WINNER')
      .map((runner) => String(runner.selectionId ?? '').trim())
      .filter(Boolean);

    // Only use classic place market winner sets (top-2 / top-3).
    if (winners.length !== 2 && winners.length !== 3) {
      return;
    }

    const existing = placeWinnersByEvent.get(eventId) ?? [];
    existing.push(new Set(winners));
    placeWinnersByEvent.set(eventId, existing);
  });

  return baseResults.map((result) => {
    const winnerId = result.winnerId;
    if (!winnerId) {
      return result;
    }

    const eventId = eventByWinMarketId.get(result.marketId);
    if (!eventId) {
      return result;
    }

    const placeSets = placeWinnersByEvent.get(eventId) ?? [];
    if (!placeSets.length) {
      return result;
    }

    const top2Sets = placeSets.filter((set) => set.size === 2 && set.has(winnerId));
    const top3Sets = placeSets.filter((set) => set.size === 3 && set.has(winnerId));

    let inferredSecondId: string | null = null;
    let inferredThirdId: string | null = null;

    if (top2Sets.length === 1) {
      const candidates = [...top2Sets[0]].filter((id) => id !== winnerId);
      if (candidates.length === 1) {
        inferredSecondId = candidates[0];
      }
    }

    if (inferredSecondId && top3Sets.length >= 1) {
      // If multiple top-3 sets exist, they must agree on the remaining third runner.
      const thirdCandidates = top3Sets
        .map((set) => [...set].filter((id) => id !== winnerId && id !== inferredSecondId))
        .filter((arr) => arr.length === 1)
        .map((arr) => arr[0]);

      const uniqueThird = [...new Set(thirdCandidates)];
      if (uniqueThird.length === 1) {
        inferredThirdId = uniqueThird[0];
      }
    }

    if (!inferredSecondId && !inferredThirdId) {
      return result;
    }

    return {
      ...result,
      secondId: inferredSecondId,
      thirdId: inferredThirdId,
      inferredPlaces: true,
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
      .map((runner, idx) => {
        let name = String(runner.runnerName || '').trim();
        if (!name) {
          // Use selectionId as fallback instead of index-based name
          name = `${String(runner.selectionId || `UnknownRunner${idx + 1}`)}`;
        }
        return {
          id: String(runner.selectionId ?? ''),
          name,
          number: typeof runner.sortPriority === 'number' ? runner.sortPriority : null,
        };
      })
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