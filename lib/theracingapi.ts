export interface Meet {
  meet_id: string;
  course: string;
  date: string;
  state: string;
}

// Sportbex API settings. If SPORTBEX_BASE_URL is set, the app will try to use it
// for real Sportbex data. If the host isn't reachable or doesn't return usable
// data, we fall back to the hardcoded list and placeholder races.
//
// The trial Sportbex API uses `https://trial-api.sportbex.com/api/betfair`.
const SPORTBEX_BASE_URL = process.env.SPORTBEX_BASE_URL ?? 'https://trial-api.sportbex.com/api/betfair';
const SPORTBEX_API_KEY = process.env.SPORTBEX_API_KEY;

async function sportbexFetch(path: string, opts: RequestInit = {}) {
  const url = `${SPORTBEX_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (SPORTBEX_API_KEY) {
    // The trial Sportbex API expects the API key in this header.
    headers['sportbex-api-key'] = SPORTBEX_API_KEY;
  }
  console.log('sportbexFetch: calling', url, 'with headers', Object.keys(headers));
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sportbex request failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchSportbexCompetitions() {
  // Attempt to fetch all Australian horse racing competitions.
  // The trial API uses the endpoint: /competitions/7
  const json: any = await sportbexFetch('competitions/7');
  const items = Array.isArray(json) ? json : Array.isArray(json.competitions) ? json.competitions : Array.isArray(json.items) ? json.items : [];
  const auItems = items.filter((item: any) => String(item.competitionRegion ?? '').toUpperCase() === 'AU');
  return auItems.map((item: any) => item.competition).filter(Boolean);
}

async function fetchSportbexEvents(competitionId: string, date?: string) {
  // Events endpoint: /event/7/{competitionId}
  const json: any = await sportbexFetch(`event/7/${competitionId}`);
  const items = Array.isArray(json) ? json : Array.isArray(json.events) ? json.events : Array.isArray(json.items) ? json.items : [];
  const events = items.map((item: any) => item.event).filter(Boolean);

  if (date) {
    // Filter by date (ISO YYYY-MM-DD) if provided.
    const normalizedDate = date.slice(0, 10);
    return events.filter((event: any) => {
      const openDate = (event.openDate ?? event.start ?? event.date ?? '').slice(0, 10);
      return openDate === normalizedDate;
    });
  }

  return events;
}

async function fetchSportbexMarkets(eventId: string) {
  // Markets endpoint: /markets/7/{eventId}
  const json: any = await sportbexFetch(`markets/7/${eventId}`);
  const items = Array.isArray(json) ? json : Array.isArray(json.markets) ? json.markets : Array.isArray(json.items) ? json.items : [];
  return items;
}

async function fetchSportbexMarketBook(marketIds: string[]) {
  const body = { marketIds: marketIds.join(',') };
  const json: any = await sportbexFetch('listMarketBook/7', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return json.data || [];
}

export async function fetchMeets(date: string): Promise<{ meets: Meet[] }> {
  // If a Sportbex base URL is configured, try using the real API.
  // This will return the live competition list (filtered to AU) when it works.
  if (process.env.SPORTBEX_BASE_URL) {
    try {
      const competitions = await fetchSportbexCompetitions();
      const auCompetitions = competitions.filter((c: any) =>
        String(c.name ?? c.competitionName ?? '').startsWith('AU-') ||
        String(c.countryCode ?? c.region ?? '').toUpperCase().startsWith('A')
      );

      if (auCompetitions.length) {
        const meets: Meet[] = auCompetitions.map((comp: any) => ({
          meet_id: String(comp.id ?? comp.competitionId ?? comp.competition_id),
          course: String((comp.name ?? comp.competitionName ?? '').replace(/^AU-/, '')),
          date,
          state: 'AUS',
        }));

        console.log('fetchMeets: returning', meets.length, 'AU meets from Sportbex');
        return { meets };
      }
    } catch (err) {
      console.warn('fetchMeets: Sportbex API failed', err);
    }
  }

  // No data available.
  return { meets: [] };
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

export async function fetchRacesForCourse(
  courseId: string,
  date: string,
  debug = false
): Promise<{ races: Race[]; raw?: unknown }> {
  console.log('fetchRacesForCourse: called with courseId=', courseId, 'date=', date);
  // If a Sportbex base URL is configured, try fetching real events/markets.
  if (process.env.SPORTBEX_BASE_URL) {
    try {
      console.log('fetchRacesForCourse: trying Sportbex API');
      const events = await fetchSportbexEvents(courseId, date);
      console.log('fetchRacesForCourse: got', events.length, 'events');
      if (events.length) {
        // Use the first event for this competition (often 'today') and fetch markets for it.
        const event = events[0];
        const eventId = String(event.id ?? event.eventId ?? event.event_id);
        console.log('fetchRacesForCourse: using eventId=', eventId);
        const markets = await fetchSportbexMarkets(eventId);
        console.log('fetchRacesForCourse: got', markets.length, 'markets');

        if (markets.length) {
          const marketIds = markets.map((m: any) => m.marketId ?? m.id);
          console.log('fetchRacesForCourse: fetching market book for', marketIds.length, 'markets');
          const marketBooks = await fetchSportbexMarketBook(marketIds);
          const bookMap = new Map<string, any[]>();
          marketBooks.forEach((book: any) => {
            bookMap.set(book.marketId, book.runners || []);
          });

          const sortedMarkets = [...markets].sort((a: any, b: any) => {
            const aTs = Date.parse(a.marketStartTime ?? a.startTime ?? a.start ?? '');
            const bTs = Date.parse(b.marketStartTime ?? b.startTime ?? b.start ?? '');
            if (Number.isNaN(aTs) || Number.isNaN(bTs)) return 0;
            return aTs - bTs;
          });

          const lastMarkets = sortedMarkets.slice(-4);

          const getMarketTime = (market: any) => {
            return (
              market.marketStartTime ??
              market.startTime ??
              market.start ??
              market.market?.marketStartTime ??
              market.market?.startTime ??
              market.description?.marketTime ??
              market.description?.marketStartTime ??
              ''
            );
          };

          const races: Race[] = lastMarkets.map((market: any, idx: number) => {
            const marketName = String(market.marketName ?? market.name ?? `Race ${idx + 1}`);
            const bookRunners = bookMap.get(market.marketId ?? market.id) || [];
            const runnerMap = new Map<number, any>();
            bookRunners.forEach((r: any) => runnerMap.set(r.selectionId, r));

            return {
              id: String(market.marketId ?? market.id ?? `${courseId}-${idx + 1}`),
              name: marketName,
              time: String(getMarketTime(market) ?? ''),
              courseId,
              runners: market.runners.map((runner: any) => {
                const bookRunner = runnerMap.get(parseInt(runner.selectionId ?? runner.id ?? '0'));
                return {
                  id: String(runner.selectionId ?? runner.runnerId ?? runner.id ?? runner.outcomeId ?? `${idx}-${runner?.id ?? idx}`),
                  name: String(runner.runnerName ?? runner.name ?? runner.label ?? `Runner ${idx + 1}`),
                  number: parseInt(runner.metadata?.CLOTH_NUMBER ?? runner.number ?? idx + 1) || (idx + 1),
                  odds: (bookRunner?.ex?.availableToBack?.[0]?.price ?? bookRunner?.lastPriceTraded)?.toString() || '',
                  jockey: runner.metadata?.JOCKEY_NAME ?? '',
                  trainer: runner.metadata?.TRAINER_NAME ?? '',
                  weight: runner.metadata?.WEIGHT_VALUE ?? '',
                  age: runner.metadata?.AGE ?? '',
                  form: runner.metadata?.FORM ?? '',
                  colours: runner.metadata?.COLOURS_DESCRIPTION ?? '',
                };
              }),
            };
          });

          if (debug) {
            console.log('fetchRacesForCourse: returning Sportbex markets for', courseId);
          }
          console.log('fetchRacesForCourse: success, returning', races.length, 'races');
          return { races, raw: { events, markets } };
        }
      }
    } catch (err) {
      console.warn('fetchRacesForCourse: Sportbex API failed', err);
    }
  }

  // No data available.
  console.log('fetchRacesForCourse: no data available, returning empty');
  return { races: [] };
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

export async function fetchMarketResults(marketIds: string[]): Promise<RaceResult[]> {
  if (!marketIds.length) return [];

  if (!SPORTBEX_API_KEY) {
    throw new Error('SPORTBEX_API_KEY is not configured on the server. Add it to .env.local and restart the app.');
  }

  const books = await fetchSportbexMarketBook(marketIds);
  return (Array.isArray(books) ? books : [])
    .filter((book: any) => book && (book.marketId ?? book.id))
    .map((book: any) => {
    const runners: any[] = Array.isArray(book.runners) ? book.runners : [];
    const winner = runners.find((r: any) => String(r.status ?? '').toUpperCase() === 'WINNER');
    return {
      marketId: String(book.marketId ?? book.id),
      winnerId: winner ? String(winner.selectionId) : null,
      settled: ['CLOSED', 'SETTLED'].includes(String(book.status ?? '').toUpperCase()),
    };
  });
}

export async function fetchMarketRunners(marketId: string): Promise<MarketRunner[]> {
  const id = String(marketId || '').trim();
  if (!id) return [];

  if (!SPORTBEX_API_KEY) {
    throw new Error('SPORTBEX_API_KEY is not configured on the server. Add it to .env.local and restart the app.');
  }

  const books = await fetchSportbexMarketBook([id]);
  const book = (Array.isArray(books) ? books : []).find((item: any) => String(item?.marketId ?? item?.id ?? '') === id);
  const runners: any[] = Array.isArray(book?.runners) ? book.runners : [];

  return runners
    .map((runner: any, idx: number) => {
      const numberValue = Number.parseInt(String(runner?.sortPriority ?? runner?.metadata?.CLOTH_NUMBER ?? ''), 10);
      return {
        id: String(runner?.selectionId ?? runner?.id ?? ''),
        name: String(runner?.runnerName ?? runner?.name ?? `Runner ${idx + 1}`),
        number: Number.isNaN(numberValue) ? null : numberValue,
      };
    })
    .filter((runner: MarketRunner) => Boolean(runner.id));
}

