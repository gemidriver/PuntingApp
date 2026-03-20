import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const PROXY_AUTH_TOKEN = process.env.PROXY_AUTH_TOKEN || '';

const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY || '';
const BETFAIR_USERNAME = process.env.BETFAIR_USERNAME || '';
const BETFAIR_PASSWORD = process.env.BETFAIR_PASSWORD || '';
const BETFAIR_BETTING_API_URL =
  process.env.BETFAIR_BETTING_API_URL || 'https://api-au.betfair.com/exchange/betting/json-rpc/v1';
const BETFAIR_LOGIN_URL = process.env.BETFAIR_LOGIN_URL || 'https://identitysso.betfair.com.au/api/login';

let currentSessionToken = process.env.BETFAIR_SESSION_TOKEN || '';
let loginPromise = null;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function loginInteractive() {
  if (!BETFAIR_APP_KEY || !BETFAIR_USERNAME || !BETFAIR_PASSWORD) {
    throw new Error('Missing BETFAIR_APP_KEY/BETFAIR_USERNAME/BETFAIR_PASSWORD on proxy');
  }

  const body = new URLSearchParams({
    username: BETFAIR_USERNAME,
    password: BETFAIR_PASSWORD,
  });

  const response = await fetch(BETFAIR_LOGIN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Application': BETFAIR_APP_KEY,
    },
    body: body.toString(),
  });

  const raw = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Login returned non-JSON (${response.status})`);
  }

  if (!response.ok || !parsed?.token || !['SUCCESS', 'LIMITED_ACCESS'].includes(String(parsed?.status || '').toUpperCase())) {
    throw new Error(`Login failed (${response.status}): ${parsed?.status || 'UNKNOWN'} ${parsed?.error || ''}`.trim());
  }

  currentSessionToken = parsed.token;
  return currentSessionToken;
}

async function ensureToken() {
  if (!currentSessionToken) {
    if (!loginPromise) {
      loginPromise = loginInteractive().finally(() => {
        loginPromise = null;
      });
    }
    await loginPromise;
  }

  return currentSessionToken;
}

async function callBetfair(method, params, allowRetry = true) {
  const token = await ensureToken();

  const response = await fetch(BETFAIR_BETTING_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Application': BETFAIR_APP_KEY,
      'X-Authentication': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: `SportsAPING/v1.0/${method}`,
      params,
      id: 1,
    }),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Betfair non-JSON response (${response.status})`);
  }

  const envelope = Array.isArray(payload) ? payload[0] : payload;
  const message = String(envelope?.error?.message || raw || 'Unknown error');

  if (!response.ok || envelope?.error) {
    if (allowRetry && /ANGX-0003|INVALID_SESSION_INFORMATION|NO_SESSION/i.test(message)) {
      currentSessionToken = '';
      await ensureToken();
      return callBetfair(method, params, false);
    }

    throw new Error(`Betfair error (${response.status}): ${message}`);
  }

  return envelope?.result;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        env: {
          appKeyConfigured: Boolean(BETFAIR_APP_KEY),
          usernameConfigured: Boolean(BETFAIR_USERNAME),
          passwordConfigured: Boolean(BETFAIR_PASSWORD),
          hasSessionToken: Boolean(currentSessionToken),
        },
      });
    }

    if (req.url === '/rpc' && req.method === 'POST') {
      if (PROXY_AUTH_TOKEN) {
        const incoming = req.headers['x-proxy-token'];
        if (incoming !== PROXY_AUTH_TOKEN) {
          return json(res, 401, { error: 'Unauthorized proxy token' });
        }
      }

      const body = await readJson(req);
      const method = String(body?.method || '').trim();
      const params = body?.params && typeof body.params === 'object' ? body.params : {};

      if (!method) {
        return json(res, 400, { error: 'method is required' });
      }

      const result = await callBetfair(method, params);
      return json(res, 200, { result });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Betfair proxy listening on port ${PORT}`);
});
