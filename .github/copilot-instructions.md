# Copilot Instructions

This repository contains a small Next.js (App Router) project that helps users pick horses across two race meets and choose a wildcard horse.

## Key Points

- The app fetches meet/race/result data from Betfair API-NG via server-side proxy routes.
- Real API credentials are stored in `.env.local`:
  - `BETFAIR_APP_KEY`
  - `BETFAIR_SESSION_TOKEN`

## Useful Commands

- `npm install`
- `npm run dev`
- `NEXT_DISABLE_TURBOPACK=1 npm run dev` (if the dev server crashes)
- `npm run build`

## Notes

- Wildcard selection is limited to a single race. The UI enforces this by allowing only one wildcard assignment.
- The app only supports selecting up to two meets at a time.
