# Horse Racing Syndicate App

A Next.js application for managing horse racing syndicate selections. Users can select horses from two Australian race meets, choose one horse per race from the last 4 races, and pick a wildcard that doubles points. Points are awarded based on race results (1st: 4pts, 2nd: 2pts, 3rd: 1pt).

## Features

- Select 2 Australian race meets
- View last 4 races per meet with horse lists
- Select one horse per race
- Choose a wildcard horse for double points
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

This app can fetch race meets and runner lists from Sportbex (trial API) when you provide an API key.

### Setting credentials

Create a file named `.env.local` in the project root with the Sportbex API key:

```env
SPORTBEX_API_KEY=your_sportbex_api_key_here
```

Optionally, you can override the base URL used for Sportbex calls (default is the trial API):

```env
SPORTBEX_BASE_URL=https://trial-api.sportbex.com/api/betfair
```

The server-side API routes used by the app are:

- `/api/meets` — fetches competitions (meets)
- `/api/races` — fetches race markets and runners for a selected meet

If the Sportbex API is unreachable or the key is invalid, the app falls back to a hardcoded list of AU race meets and placeholder races.

### Mock data mode

Set `USE_MOCK_DATA=true` in `.env.local` to run the app with built-in mock meets and races (no API credentials needed). This is helpful when the API credentials are missing or the API is unreachable.

## Supabase Persistence (Accounts + Selections)

This project now uses Supabase for:

- account authentication
- persistent admin/user profiles
- shared global meet selection
- persistent user selections and submitted picks

### 1) Create a Supabase project

Create a new project in Supabase and keep your project URL and anon key.

### 2) Run database schema

Open the Supabase SQL editor and run:

- `supabase/schema.sql`

This creates `profiles`, `app_settings`, and `user_submissions` tables, plus RLS policies.

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
```

For Vercel, add the same variables in Project Settings -> Environment Variables.

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
- The server-side route uses the credentials and calls `https://api.theracingapi.com/v1/racecards/basic`.
- The server returns meet data to the client for display.

## Technologies Used

- Next.js 16
- TypeScript
- Tailwind CSS
- React Hooks

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
