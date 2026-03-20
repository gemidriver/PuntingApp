Betfair Oracle Proxy (Free-friendly)

Purpose
- Run this on an Oracle VM in AU/NZ and let your main app call this proxy.
- The proxy handles Betfair session refresh and shields your app from direct Betfair egress restrictions.

Requirements
- Node.js 20+
- Open inbound TCP 8080 (or place behind Nginx/Caddy and TLS)

Environment variables
- PORT=8080
- PROXY_AUTH_TOKEN=your_shared_secret
- BETFAIR_APP_KEY=...
- BETFAIR_USERNAME=...
- BETFAIR_PASSWORD=...
- Optional: BETFAIR_SESSION_TOKEN=...
- Optional: BETFAIR_BETTING_API_URL=https://api-au.betfair.com/exchange/betting/json-rpc/v1
- Optional: BETFAIR_LOGIN_URL=https://identitysso.betfair.com.au/api/login

Run
1. node server.mjs

Endpoints
- GET /health
- POST /rpc
  Body: { "method": "listMarketCatalogue", "params": { ... } }
  Header: X-Proxy-Token: your_shared_secret

Connect app to proxy
Set these in horse-racing-app deployment env:
- BETFAIR_PROXY_URL=https://your-proxy-domain-or-ip:8080
- BETFAIR_PROXY_TOKEN=your_shared_secret

Notes
- Keep PROXY_AUTH_TOKEN private.
- Do not expose BETFAIR credentials to the browser.
- Rotate Betfair credentials if they were shared.
