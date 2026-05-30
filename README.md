# Kadi React

Mobile-friendly React prototype for the Kenyan card game Kadi.

## Local development

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. By default the local app runs on `http://127.0.0.1:4173/`.

The app now uses a Node/Socket.IO server, so `npm run dev` builds the frontend and starts the same server Render will run.

## Render deployment

This repo includes `render.yaml` for Render Web Service deployment.

Manual Render settings:

- Service type: Web Service
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Node version: `20`

## Room links

Players can create a room from the app. The lobby shows:

- a room code, such as `A7KQ2`
- a share link, such as `https://your-render-app.onrender.com/room/A7KQ2`

Friends can join with either the link or the room code, enter their preferred names, and wait for the host to start the game.
