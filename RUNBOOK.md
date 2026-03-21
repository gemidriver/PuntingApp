# Punting App Runbook

## 1. System Overview

Production request path:

1. Browser -> Vercel app (`punting-app.vercel.app`)
2. App API route -> Betfair proxy URL (`BETFAIR_PROXY_URL`)
3. Cloudflare DNS/Tunnel (`betfair-proxy.thetoppunter.com`)
4. Raspberry Pi (Home Assistant) -> Node-RED endpoint (`/endpoint/rpc`)
5. Node-RED -> Betfair AU API (`https://api-au.betfair.com/exchange/betting/json-rpc/v1`)
6. Response flows back the same path

The app should not rely on direct Vercel -> Betfair calls in production.

## 2. Critical Components

- Vercel deployment (frontend + Next.js API routes)
- Cloudflare domain and Tunnel
- Raspberry Pi / Home Assistant add-ons:
  - Cloudflared
  - Node-RED
- Supabase:
  - `app_settings` (live/current state + previous snapshot)
  - `round_history` (append-only historical rounds)
- Betfair credentials/token flow in Node-RED

## 3. Required Environment Variables

### Vercel (Production)

- `BETFAIR_PROXY_URL=https://betfair-proxy.thetoppunter.com/endpoint`
- `BETFAIR_PROXY_TOKEN=<shared_proxy_token>`
- `RESEND_API_KEY=<your_resend_api_key>` (for email reminders)
- `RESEND_FROM_EMAIL=racing@braddo-punting.com` (or your domain)
- `CRON_SECRET=<strong_random_secret>` (for cron job authentication)

Notes:

- Do not include `/rpc` in `BETFAIR_PROXY_URL`.
- App appends `/rpc` internally.
- Resend API key obtained from https://resend.com (free tier available).
- Generate `CRON_SECRET` with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Email reminders require Supabase race_reminders table (run schema migration).

### Node-RED

- `PROXY_TOKEN` value must match `BETFAIR_PROXY_TOKEN` from Vercel.
- `BETFAIR_APP_KEY` configured.
- Betfair session token handled by refresh flow and stored in `global.betfairToken`.

## 4. Daily Operations

### Morning check (2-3 min)

1. Open app home screen and confirm latest version badge is visible.
2. In Admin screen, run Betfair health check:
   - Status should be reachable/ok
   - Non-zero market/event counts expected on race days
3. Confirm Node-RED token refresh log shows recent successful refresh.
4. Confirm Cloudflared add-on is running and connected.

### Before users pick

1. Publish the two global meets for the day.
2. Verify races/runners load in UI.
3. Spot-check one market for real horse names (not placeholders).

### End of round

1. Ensure results are fetched/manual placings completed.
2. Verify home screen shows final points/results.
3. Click `Close Meet & Start New Day`.
4. Confirm previous round remains visible on home.
5. (Optional) Publish next two meets immediately.

## 5. Email Reminders (Automatic)

### Overview

The app automatically sends email reminders to all users 5 minutes before each race starts.

**How it works:**
- A Vercel cron job runs every minute and checks upcoming races
- When a race is found within the 5-minute window, emails are sent to all registered users
- Race reminders are tracked to avoid sending duplicates
- Reminders show the course, race name, and exact start time

**Requirements:**
- Resend API key configured in Vercel env vars
- `race_reminders` table created in Supabase
- `CRON_SECRET` env var set for webhook authentication
- Users must have valid email addresses in their profiles

**Monitoring:**
- Check Vercel Logs tab under Cron Jobs to verify reminders are executing
- Review recent deployments to ensure race-reminders endpoint is deployed
- Resend dashboard shows delivery status for all emails sent

### Setup Steps (First Time Only)

1. Create Resend API key:
   - Go to https://resend.com/api-keys
   - Create new API key, copy it
   
2. Add Vercel env vars:
   - `RESEND_API_KEY=<api_key_from_resend>`
   - `RESEND_FROM_EMAIL=racing@youromain.com`
   - `CRON_SECRET=<generate_with_openssl_rand_hex_32>`

3. Run Supabase migration:
   ```sql
   -- Create race_reminders table
   create table if not exists public.race_reminders (
     id bigserial primary key,
     race_id text not null,
     race_name text not null,
     race_time timestamptz not null,
     course text not null,
     meet_id text not null,
     reminder_sent_at timestamptz not null default now(),
     unique (race_id)
   );
   ```

4. Redeploy app to Vercel (vercel.json includes cron config)

## 6. Incident Playbooks

### A) Betfair health shows `HTTP 403` with HTML page

Meaning: app is calling Betfair directly, proxy env not active.

Actions:

1. Verify Vercel Production env vars are set:
   - `BETFAIR_PROXY_URL`
   - `BETFAIR_PROXY_TOKEN`
2. Redeploy production after saving env vars.
3. Recheck health endpoint.

### B) `502` from proxy domain

Meaning: tunnel reached, upstream Node-RED failed.

Actions:

1. Test local Node-RED endpoint on LAN first.
2. Confirm Node-RED flow returns valid JSON.
3. Confirm Cloudflared `additional_hosts` points to the right Node-RED target.
4. Check Node-RED logs for Betfair/API errors.

### C) `524` timeout from Cloudflare

Meaning: request hung waiting for origin.

Actions:

1. Check Node-RED flow wiring has terminal HTTP response path.
2. Ensure no broken/blank header config in HTTP request node.
3. Add/verify catch path in Node-RED to always return an error response.

### D) `INVALID_SESSION_INFORMATION` from Betfair

Meaning: Betfair session token expired/invalid.

Actions:

1. Validate Node-RED token refresh flow is running and successful.
2. Trigger manual refresh inject node in Node-RED.
3. Confirm `global.betfairToken` updated.
4. Retest local endpoint, then public endpoint.

### E) Home/manual screens show `Runner #` placeholders

Meaning: upstream runner names incomplete, fallback names used.

Actions:

1. Fetch/load runners for affected races again.
2. Confirm cached/submission names are present.
3. Reapply manual placings if needed to persist improved names.
4. If still bad, check Node-RED Betfair response payload for missing `runnerName`.

## 7. Verification Commands (PowerShell)

### Proxy test (public)

```powershell
$token = "<proxy_token>"
$body = '{"method":"listEventTypes","params":{"filter":{}}}'
Invoke-RestMethod -Uri "https://betfair-proxy.thetoppunter.com/endpoint/rpc" -Method POST -Headers @{"x-proxy-token"=$token} -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 10
```

### App health test

```powershell
Invoke-RestMethod -Uri "https://punting-app.vercel.app/api/health/betfair" | ConvertTo-Json -Depth 10
```

## 8. Data Retention Model

Current/live state:

- `app_settings.global_meets`
- `app_settings.race_results`
- `app_settings.race_runners`

Previous round snapshot:

- `app_settings.previous_round_snapshot`

Historical rounds (append-only):

- `round_history` rows written when closing a meet/day

## 9. Deploy Checklist

1. Push changes to main.
2. Wait for Vercel build.
3. Confirm version badge updates (`0.1.M.D.HHmm`).
4. Run health check.
5. Verify one race/runner screen and one submissions screen.

## 10. Security Notes

- Rotate proxy token if shared externally.
- Do not store secrets in source-controlled files.
- Restrict Supabase write policies to admins where intended.
- Keep Home Assistant / add-ons updated.
