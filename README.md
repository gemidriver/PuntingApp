# Horse Racing Syndicate App

A Next.js application for managing horse racing syndicate selections. Users can select horses from two Australian race meets, choose one horse per race from the last 4 races, and pick a wildcard that doubles points. Points are awarded based on race results (1st: 4pts, 2nd: 2pts, 3rd: 1pt).

## Features

- Select 2 Australian race meets
- View last 4 races per meet with horse lists
- Select one horse per race
- Choose a wildcard horse for double points
- Automatically hides expired race-day data once the meet date has passed
- Admin can clear the finished race day and publish a new pair of global meets for everyone
- Publishing new global meets resets all user selections, wildcard picks, and stored results
- Mock data integration (ready for theracingapi.com API)

## Getting Started

First, install dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

> If Next.js crashes due to Turbopack internal errors, run with Turbopack disabled:
>
> ```bash
> NEXT_DISABLE_TURBOPACK=1 npm run dev
> ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Integration

This app now fetches race meets, races, runners, and market outcomes from Betfair API-NG.

### Setting credentials

Create or update `.env.local` in the project root with:

```env
BETFAIR_APP_KEY=your_betfair_app_key_here
BETFAIR_SESSION_TOKEN=your_betfair_session_token_here
```

Optional override (default should be fine):

```env
BETFAIR_BETTING_API_URL=https://api-au.betfair.com/exchange/betting/json-rpc/v1
```

Optional proxy mode (recommended when your hosting provider is blocked by Betfair):

```env
BETFAIR_PROXY_URL=https://your-oracle-proxy-domain
BETFAIR_PROXY_TOKEN=your_shared_proxy_secret
```

When `BETFAIR_PROXY_URL` is set, this app sends Betfair RPC calls to your proxy instead of directly to Betfair.

Notes:

- `BETFAIR_APP_KEY` is your Betfair application key.
- `BETFAIR_SESSION_TOKEN` is typically required for API-NG requests (header `X-Authentication`).
- If you see invalid session errors, refresh your Betfair login/session token and restart the app.
- `BETFAIR_PROXY_TOKEN` should match the proxy server secret header check.

The server-side API routes used by the app are:

- `/api/meets` — list AU horse racing meets (derived from `listMarketCatalogue`)
- `/api/races` — list WIN markets and runners for a selected meet (`competitionId`)
- `/api/results` — fetch market winners/settled state (`listMarketBook`)
- `/api/market-runners` — fetch runner names for a market

## Supabase Persistence (Accounts + Selections)

This project now uses Supabase for:

- account authentication
- persistent admin/user profiles
- shared global meet selection
- persistent user selections and submitted picks
- shared submissions view for all signed-in users

### 1) Create a Supabase project

Create a new project in Supabase and keep your project URL and anon key.

### 2) Run database schema

Open the Supabase SQL editor and run:

- `supabase/schema.sql`

This creates `profiles`, `app_settings`, and `user_submissions` tables, plus RLS policies.

If your Supabase project already exists, rerun the SQL after pulling changes so the `user_submissions` select policy is updated to allow all authenticated users to view the submissions screen.

It also creates race outcomes and scoring tables:

- `race_results`: one row per horse result in each race
- `user_selection_scores`: per-user scored selections for leaderboard math

After importing race results for a meet, run this SQL function to compute points:

```sql
select public.recalculate_scores_for_meet('YOUR_MEET_ID');
```

Points model used by the function:

- 1st = 4 points
- 2nd = 2 points
- 3rd = 1 point
- Wildcard doubles points for the selected race

### 3) Add environment variables

Use `.env.example` as a template and add values in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SITE_URL=https://your-production-domain.vercel.app
```

For Vercel, add the same variables in Project Settings -> Environment Variables.

In Supabase Authentication -> URL Configuration, also set:

- Site URL = your production app URL
- Additional Redirect URLs = your production URL and any local dev URL you use

Example:

- `https://your-production-domain.vercel.app`
- `http://localhost:3000`

### 4) Username vs email login

You can log in with a username or an email on the login form:

- If it already contains `@`, it is used as email.
- If not, the app looks up the matching profile email in Supabase and signs in with that account.

For registration, users should provide:

- a username
- a real email address
- a password

This keeps the username-style UX while using Supabase Auth in the normal supported way.

### How it works

- The client (browser) fetches `/api/meets?date=YYYY-MM-DD`.
- The server-side route calls Betfair JSON-RPC (`SportsAPING/v1.0/listMarketCatalogue`) using your app key/session headers.
- The server normalizes Betfair responses to the app's meet/race runner format.

## Technologies Used

- Next.js 16
- TypeScript
- Tailwind CSS
- React Hooks

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
