# Kadi React

Mobile- and desktop-friendly React client for the Kenyan card game Kadi, with realtime multiplayer rooms — fully on Vercel.

## Architecture

- **Frontend**: Vite + React static build.
- **Backend**: a single Vercel serverless function ([api/kadi.js](api/kadi.js)) handling room/game actions.
- **State**: room and game state live in Upstash Redis (via the Vercel Marketplace integration), read-modify-written with optimistic concurrency (compare-and-swap) so concurrent moves from different players never clobber each other.
- **Transport**: plain HTTP polling (`~1.5s`), not WebSockets. Socket.IO needs sticky sessions that serverless platforms like Vercel don't provide; polling is stateless per request, so it fits serverless correctly and the latency is imperceptible for a turn-based card game.

## Local development

For full-stack testing (frontend + the `/api/kadi` function + Redis), run:

```bash
npm install
vercel dev
```

`vercel dev` reads Redis credentials from `.env.local` (created automatically when the Upstash integration was connected via `vercel integration add` / `vercel env pull`).

`npm run dev` (plain `vite`) also works for frontend-only UI iteration, but `/api/kadi` calls will 404 since nothing serves them outside `vercel dev` or a real deployment.

## Deployment

This is a single Vercel project — no separate backend host needed.

1. Import the repo at [vercel.com/new](https://vercel.com/new) (or `vercel deploy --prod` from this directory once linked).
2. Add Redis storage once, from the Vercel dashboard: **Storage → Marketplace Database Integrations → Upstash for Redis** (or `vercel integration add upstash/upstash-kv`), then connect it to this project. That sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically — no other env vars needed.
3. Deploy. `vercel.json` handles the SPA rewrite so links like `/room/A7KQ2` work on refresh; `/api/*` routes are served by the function directly.

## Rooms & reconnection

- Each browser gets a persistent player token (stored in `localStorage`), independent of any single request.
- Every poll/action refreshes that player's presence timestamp in Redis. Losing connectivity (tab backgrounded, phone locked, network blip) doesn't remove you from a room — the server holds your seat for 45s, and the client auto-resumes polling as your token as soon as it's back online.
- If it's your turn and you're gone for more than 20s, the server auto-draws for you so the table isn't stuck waiting.
- Room state expires from Redis after 6 hours of inactivity, so abandoned rooms clean themselves up.

## Room links

Players can create a room from the app. The lobby shows:

- a room code, such as `A7KQ2`
- a share link, such as `https://your-app.vercel.app/room/A7KQ2`

Friends can join with either the link or the room code, enter their preferred names, and wait for the host to start the game.
