# Kadi React

Mobile- and desktop-friendly React client for the Kenyan card game Kadi, with realtime multiplayer rooms over Socket.IO.

## Local development

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. By default the local app runs on `http://127.0.0.1:4173/`.

`npm run dev` builds the frontend and starts the same Node/Socket.IO server used in production, so the client talks to `server.js` on the same origin — no `.env` needed locally.

## Deployment: Vercel (frontend) + Render (realtime server)

Socket.IO rooms keep their state in memory on a single long-running process, which Vercel's serverless functions can't provide. So the app deploys as two pieces:

- **Frontend (static)** → Vercel. `vercel.json` builds with `vite build` and serves `dist/`, rewriting all routes to `index.html` so links like `/room/A7KQ2` work on refresh.
- **Realtime server** → Render (or any long-running Node host). `render.yaml` is already set up for this: `npm ci && npm run build` then `npm start` (`node server.js`), which also happens to serve the built frontend itself as a fallback.

Steps:

1. Deploy the repo to Render (or run `render.yaml` as a Blueprint). Note the server's URL, e.g. `https://kadi-react.onrender.com`.
2. In your Vercel project settings, set the environment variable `VITE_SERVER_URL` to that Render URL (see `.env.example`). Redeploy so the build picks it up.
3. Optionally lock down the Render server's `ALLOWED_ORIGIN` env var to your Vercel domain instead of `*`.

If you'd rather run everything as one service (no Vercel), just deploy `render.yaml` alone and skip `VITE_SERVER_URL` — the client defaults to same-origin.

## Rooms & reconnection

- Each browser gets a persistent player token (stored in `localStorage`), independent of the Socket.IO connection id.
- Losing the connection (tab backgrounded, phone locked, network blip) doesn't remove you from a room — the server holds your seat for 45s, and the client auto-rejoins with your token as soon as it reconnects.
- If it's your turn and you're gone for more than 20s, the server auto-draws for you so the table isn't stuck waiting.

## Room links

Players can create a room from the app. The lobby shows:

- a room code, such as `A7KQ2`
- a share link, such as `https://your-app.vercel.app/room/A7KQ2`

Friends can join with either the link or the room code, enter their preferred names, and wait for the host to start the game.
