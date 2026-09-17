import {
  advanceTurn,
  applyCard,
  buildGame,
  cleanName,
  cleanToken,
  drawCards,
  makeRoomCode,
  nextIndex,
} from "../lib/kadiEngine.js";
import { createRoomRecord, updateRoom } from "../lib/kadiStore.js";

// A player is shown as "connected" while they've polled recently, dropped
// from the room after this long without a poll, and if it's their turn and
// they've been gone this long the server plays a card on their behalf so a
// vanished player doesn't stall the table forever.
const CONNECTED_WINDOW_MS = 6_000;
const REMOVE_AFTER_MS = 45_000;
const AUTO_SKIP_MS = 20_000;

function runMaintenance(room) {
  const now = Date.now();

  const survivors = room.players.filter((player) => now - player.lastSeenAt < REMOVE_AFTER_MS);
  if (survivors.length !== room.players.length) {
    room.players = survivors;
    if (room.players.length === 0) return;
    if (!room.players.some((player) => player.token === room.hostId)) {
      room.hostId = room.players[0].token;
    }
  }

  if (!room.game || room.game.winner) return;

  for (let guard = 0; guard < room.game.players.length; guard += 1) {
    const game = room.game;
    const currentToken = game.players[game.currentPlayer]?.id;
    const roomEntry = room.players.find((player) => player.token === currentToken);
    const awaySince = roomEntry ? now - roomEntry.lastSeenAt : Infinity;
    if (awaySince < AUTO_SKIP_MS) break;

    const count = game.pendingPenalty || 1;
    drawCards(game, game.currentPlayer, count);
    game.pendingPenalty = 0;
    game.message = `${game.players[game.currentPlayer].name} was away and picked ${count > 1 ? `${count} penalty cards` : "a card"}.`;
    game.log = [game.message, ...game.log].slice(0, 8);
    advanceTurn(game, currentToken, nextIndex(game.currentPlayer, game.direction, game.players.length));
  }
}

// Idempotent upsert: refreshes presence for an existing seat, or adds a new
// one (fresh join in the lobby, or resuming an in-progress game seat after
// being dropped for inactivity).
function touchOrRejoin(room, token, name) {
  const now = Date.now();
  const existing = room.players.find((player) => player.token === token);
  if (existing) {
    existing.lastSeenAt = now;
    if (name) existing.name = cleanName(name, existing.name);
    return;
  }

  const hasGameSeat = room.game?.players.some((player) => player.id === token);
  if (!hasGameSeat && room.status !== "lobby") {
    return { error: "That game has already started." };
  }
  if (!hasGameSeat && room.players.length >= 8) {
    return { error: "That room is full." };
  }

  room.players.push({
    token,
    name: cleanName(name, hasGameSeat ? "Player" : `Player ${room.players.length + 1}`),
    lastSeenAt: now,
  });
}

function buildSnapshot(room, token) {
  const now = Date.now();

  const roomView = {
    roomCode: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.token,
      name: player.name,
      connected: now - player.lastSeenAt < CONNECTED_WINDOW_MS,
    })),
  };

  if (!room.game) return { room: roomView, game: null };

  const game = room.game;
  const connectedByToken = new Map(
    room.players.map((player) => [player.token, now - player.lastSeenAt < CONNECTED_WINDOW_MS]),
  );

  const gameView = {
    roomCode: room.code,
    hostId: room.hostId,
    viewerId: token,
    viewerIndex: game.players.findIndex((player) => player.id === token),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      saidKadi: player.saidKadi,
      connected: connectedByToken.get(player.id) ?? false,
      hand: player.id === token
        ? player.hand
        : Array.from({ length: player.hand.length }, (_, index) => ({ id: `${player.id}-hidden-${index}` })),
    })),
    drawCount: game.drawPile.length,
    discardPile: game.discardPile,
    currentPlayer: game.currentPlayer,
    direction: game.direction,
    declaredSuit: game.declaredSuit,
    declaredRank: game.declaredRank,
    pendingPenalty: game.pendingPenalty,
    winner: game.winner,
    kadiWindowHolderId: game.kadiWindow?.holderId ?? null,
    message: game.message,
    log: game.log,
  };

  return { room: roomView, game: gameView };
}

function withPresence(action) {
  return async (body, res) => {
    const code = String(body.roomCode || "").trim().toUpperCase();
    const token = cleanToken(body.token);
    if (!code) {
      res.status(400).json({ ok: false, error: "Room code required." });
      return;
    }

    const { room, error } = await updateRoom(code, (room) => {
      runMaintenance(room);
      const presence = touchOrRejoin(room, token, body.name);
      if (presence?.error) return presence;
      return action(room, token, body);
    });

    if (error) {
      res.status(200).json({ ok: false, error });
      return;
    }
    if (!room) {
      res.status(200).json({ ok: false, error: "Room not found." });
      return;
    }

    res.status(200).json({ ok: true, roomCode: code, token, ...buildSnapshot(room, token) });
  };
}

const handleJoinOrState = withPresence(() => {});

const handleStart = withPresence((room, token) => {
  if (room.hostId !== token) return { error: "Only the host can start the game." };
  if (room.players.length < 2) return { error: "Need at least 2 players." };
  room.status = "playing";
  room.game = buildGame(room.players.map((player) => ({ token: player.token, name: player.name })));
});

const handlePlay = withPresence((room, token, body) => {
  if (!room.game) return { error: "Game hasn't started." };
  const indices = Array.isArray(body.cardIndices)
    ? body.cardIndices.map(Number)
    : [Number(body.cardIndex)];
  applyCard(room.game, token, indices, body.declaredSuit, body.declaredRank);
});

const handleDraw = withPresence((room, token) => {
  const game = room.game;
  if (!game || game.winner) return;
  if (game.players[game.currentPlayer]?.id !== token) return;

  const count = game.pendingPenalty || 1;
  drawCards(game, game.currentPlayer, count);
  game.pendingPenalty = 0;
  game.message = count > 1
    ? `${game.players[game.currentPlayer].name} picked ${count} penalty cards.`
    : `${game.players[game.currentPlayer].name} picked a card.`;
  game.log = [game.message, ...game.log].slice(0, 8);
  advanceTurn(game, token, nextIndex(game.currentPlayer, game.direction, game.players.length));
});

const handleKadi = withPresence((room, token) => {
  const game = room.game;
  if (!game || game.winner) return;
  if (!game.kadiWindow || game.kadiWindow.holderId !== token) {
    return { error: "You can only announce Niko Kadi right after the play that leaves you one move from winning." };
  }
  const player = game.players.find((p) => p.id === token);
  if (!player) return;
  player.saidKadi = true;
  game.kadiWindow = null;
  game.message = `${player.name} said Niko Kadi.`;
  game.log = [game.message, ...game.log].slice(0, 8);
});

const handleRestart = withPresence((room, token) => {
  const isHost = room.hostId === token;
  const isPostGame = Boolean(room.game?.winner);
  if (!isHost && !isPostGame) return;
  room.status = "lobby";
  room.game = null;
});

async function handleCreate(body, res) {
  const token = cleanToken(body.token);
  const name = cleanName(body.name, "Host");
  const now = Date.now();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeRoomCode();
    const room = {
      code,
      hostId: token,
      status: "lobby",
      players: [{ token, name, lastSeenAt: now }],
      game: null,
    };

    const created = await createRoomRecord(code, room);
    if (created) {
      res.status(200).json({ ok: true, roomCode: code, token, ...buildSnapshot(room, token) });
      return;
    }
  }

  res.status(500).json({ ok: false, error: "Could not create a room, try again." });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  try {
    switch (body.action) {
      case "create":
        await handleCreate(body, res);
        return;
      case "join":
      case "state":
        await handleJoinOrState(body, res);
        return;
      case "start":
        await handleStart(body, res);
        return;
      case "play":
        await handlePlay(body, res);
        return;
      case "draw":
        await handleDraw(body, res);
        return;
      case "kadi":
        await handleKadi(body, res);
        return;
      case "restart":
        await handleRestart(body, res);
        return;
      default:
        res.status(400).json({ ok: false, error: "Unknown action." });
    }
  } catch (err) {
    console.error("kadi api error", err);
    res.status(500).json({ ok: false, error: "Server error." });
  }
}
