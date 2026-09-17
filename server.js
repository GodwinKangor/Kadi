import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const RECONNECT_GRACE_MS = 45_000;
const AUTO_SKIP_MS = 20_000;

const SUITS = [
  { id: "hearts", label: "Hearts", icon: "♥", color: "red" },
  { id: "diamonds", label: "Diamonds", icon: "♦", color: "red" },
  { id: "clubs", label: "Clubs", icon: "♣", color: "black" },
  { id: "spades", label: "Spades", icon: "♠", color: "black" },
];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const ANSWERS = new Set(["A", "4", "5", "6", "7", "9", "10"]);
const QUESTIONS = new Set(["8", "Q"]);
const PENALTY_DRAW = { 2: 2, 3: 3, JOK: 5 };
const INVALID_STARTS = new Set(["A", "2", "3", "8", "J", "Q", "K", "JOK"]);
const rooms = new Map();

function createDeck() {
  const suitedCards = SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank}-${suit.id}`,
      rank,
      suit: suit.id,
    })),
  );

  return [
    ...suitedCards,
    { id: "JOK-red", rank: "JOK", suit: "joker" },
    { id: "JOK-black", rank: "JOK", suit: "joker" },
  ];
}

function shuffle(cards) {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? makeRoomCode() : code;
}

function cleanName(name, fallback) {
  return String(name || "").trim().slice(0, 18) || fallback;
}

function cleanToken(token) {
  const value = String(token || "").trim().slice(0, 64);
  return value || crypto.randomUUID();
}

function cardName(card) {
  if (!card) return "";
  if (card.rank === "JOK") return "Joker";
  const suit = SUITS.find((item) => item.id === card.suit);
  return `${card.rank}${suit?.icon ?? ""}`;
}

function buildGame(players) {
  let deck = shuffle(createDeck());
  const gamePlayers = players.map((player) => ({
    id: player.token,
    name: player.name,
    hand: [],
    saidKadi: false,
  }));

  for (let round = 0; round < 4; round += 1) {
    gamePlayers.forEach((player) => {
      player.hand.push(deck.pop());
    });
  }

  let start = deck.pop();
  while (INVALID_STARTS.has(start.rank)) {
    deck = shuffle([start, ...deck]);
    start = deck.pop();
  }

  return {
    players: gamePlayers,
    drawPile: deck,
    discardPile: [start],
    currentPlayer: 0,
    direction: 1,
    declaredSuit: null,
    pendingPenalty: 0,
    winner: null,
    message: "Match rank or suit. Say Niko Kadi before your winning round.",
    log: [`${cardName(start)} starts the discard pile.`],
  };
}

function nextIndex(current, direction, total, steps = 1) {
  return (current + direction * steps + total * steps) % total;
}

function topCard(game) {
  return game.discardPile[game.discardPile.length - 1];
}

// Jokers have no real suit, so once one is on top, suit/rank matching must
// fall back to the last non-Joker card underneath the penalty chain.
function referenceCard(game) {
  for (let i = game.discardPile.length - 1; i >= 0; i -= 1) {
    if (game.discardPile[i].rank !== "JOK") return game.discardPile[i];
  }
  return topCard(game);
}

function activeSuit(game) {
  return game.declaredSuit ?? referenceCard(game).suit;
}

function canPlay(card, game) {
  const top = topCard(game);
  if (game.pendingPenalty > 0) return card.rank === top.rank || card.rank === "A";
  if (card.rank === "JOK") return top.rank === "2" || top.rank === "3" || top.rank === "JOK";
  return card.rank === top.rank || card.suit === activeSuit(game);
}

function drawCards(game, playerIndex, count) {
  const player = game.players[playerIndex];

  for (let i = 0; i < count; i += 1) {
    if (game.drawPile.length === 0 && game.discardPile.length > 1) {
      const keep = game.discardPile[game.discardPile.length - 1];
      game.drawPile = shuffle(game.discardPile.slice(0, -1));
      game.discardPile = [keep];
    }

    const card = game.drawPile.pop();
    if (card) player.hand.push(card);
  }

  player.saidKadi = false;
}

function findQuestionAnswerIndex(card, hand, skipIndex) {
  if (!QUESTIONS.has(card.rank)) return -1;
  return hand.findIndex((next, index) => index !== skipIndex && ANSWERS.has(next.rank) && next.suit === card.suit);
}

function questionHasAnswer(card, hand) {
  return findQuestionAnswerIndex(card, hand, -1) !== -1;
}

function canWinWith(card, player) {
  if (!player.saidKadi) return false;
  if (ANSWERS.has(card.rank)) return true;
  return QUESTIONS.has(card.rank) && player.hand.length === 2 && questionHasAnswer(card, player.hand);
}

function applyCard(game, playerId, cardIndex, declaredSuit) {
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex !== game.currentPlayer || game.winner) return;

  const player = game.players[playerIndex];
  const card = player.hand[cardIndex];
  if (!card) return;

  if (!canPlay(card, game)) {
    drawCards(game, playerIndex, 1);
    game.message = `${player.name} played an invalid card and picked one.`;
    game.log = [`${player.name} tried ${cardName(card)} illegally.`, ...game.log].slice(0, 8);
    game.currentPlayer = nextIndex(game.currentPlayer, game.direction, game.players.length);
    return;
  }

  const answerIndex = QUESTIONS.has(card.rank) ? findQuestionAnswerIndex(card, player.hand, cardIndex) : -1;
  if (QUESTIONS.has(card.rank) && answerIndex === -1) {
    drawCards(game, playerIndex, 1);
    game.message = "A Question card needs an answer card in the same move.";
    game.log = [`${player.name} had no answer for ${cardName(card)} and picked one.`, ...game.log].slice(0, 8);
    game.currentPlayer = nextIndex(game.currentPlayer, game.direction, game.players.length);
    return;
  }

  const answerCard = answerIndex >= 0 ? player.hand[answerIndex] : null;
  const playedCards = answerCard ? [card, answerCard] : [card];
  const playedIds = new Set(playedCards.map((played) => played.id));
  const originalHand = [...player.hand];
  const effectiveCard = answerCard ?? card;

  player.hand = player.hand.filter((handCard) => !playedIds.has(handCard.id));
  player.saidKadi = false;
  game.discardPile.push(...playedCards);
  game.declaredSuit = null;

  let steps = 1;
  let direction = game.direction;
  let pendingPenalty = game.pendingPenalty;
  let message = answerCard
    ? `${player.name} asked ${cardName(card)} and answered with ${cardName(answerCard)}.`
    : `${player.name} played ${cardName(card)}.`;

  if (card.rank === "J") {
    steps = 2;
    message = `${player.name} jumped the next player.`;
  } else if (card.rank === "K") {
    direction = -direction;
    message = `${player.name} kicked play back.`;
  } else if (PENALTY_DRAW[card.rank]) {
    pendingPenalty += PENALTY_DRAW[card.rank];
    message = `${player.name} passed a ${pendingPenalty}-card penalty.`;
  } else if (effectiveCard.rank === "A") {
    if (game.pendingPenalty > 0) {
      pendingPenalty = 0;
      message = `${player.name} blocked the penalty with an Ace.`;
    }
    game.declaredSuit = declaredSuit ?? effectiveCard.suit;
  } else if (game.pendingPenalty > 0) {
    pendingPenalty = 0;
  }

  game.direction = direction;
  game.pendingPenalty = pendingPenalty;

  if (player.hand.length === 0) {
    if (canWinWith(card, { ...player, hand: originalHand })) {
      game.winner = player.name;
      game.message = `${player.name} wins Kadi.`;
      game.log = [`${player.name} went out with ${playedCards.map(cardName).join(" then ")}.`, ...game.log].slice(0, 8);
      return;
    }

    player.hand.push(...playedCards);
    game.discardPile = game.discardPile.slice(0, -playedCards.length);
    game.message = "You must say Niko Kadi on the previous round and finish with a winning card.";
    game.log = [`${player.name} could not win yet.`, ...game.log].slice(0, 8);
    return;
  }

  game.message = message;
  game.log = [message, ...game.log].slice(0, 8);
  game.currentPlayer = nextIndex(game.currentPlayer, direction, game.players.length, steps);
}

function makeSnapshot(room, viewerId) {
  const game = room.game;
  const viewerIndex = game.players.findIndex((player) => player.id === viewerId);
  const connectedByToken = new Map(room.players.map((player) => [player.token, player.connected]));

  return {
    roomCode: room.code,
    hostId: room.hostId,
    viewerId,
    viewerIndex,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      saidKadi: player.saidKadi,
      connected: connectedByToken.get(player.id) ?? false,
      hand: player.id === viewerId
        ? player.hand
        : Array.from({ length: player.hand.length }, (_, index) => ({ id: `${player.id}-hidden-${index}` })),
    })),
    drawCount: game.drawPile.length,
    discardPile: game.discardPile,
    currentPlayer: game.currentPlayer,
    direction: game.direction,
    declaredSuit: game.declaredSuit,
    pendingPenalty: game.pendingPenalty,
    winner: game.winner,
    message: game.message,
    log: game.log,
  };
}

// If the player whose turn it is has gone quiet (backgrounded tab, dropped
// signal), auto-draw for them after a grace period so the table isn't stuck.
function scheduleAutoSkip(room) {
  if (room.autoSkipTimer) return;
  const game = room.game;
  if (!game || game.winner) return;

  const currentToken = game.players[game.currentPlayer]?.id;
  const roomPlayer = room.players.find((player) => player.token === currentToken);
  if (roomPlayer && roomPlayer.connected !== false) return;

  room.autoSkipTimer = setTimeout(() => {
    room.autoSkipTimer = null;
    const g = room.game;
    if (!g || g.winner) return;

    const stillCurrent = g.players[g.currentPlayer]?.id === currentToken;
    const rp = room.players.find((player) => player.token === currentToken);
    const stillDisconnected = !rp || rp.connected === false;

    if (stillCurrent && stillDisconnected) {
      const count = g.pendingPenalty || 1;
      drawCards(g, g.currentPlayer, count);
      g.pendingPenalty = 0;
      g.message = `${g.players[g.currentPlayer].name} was away and picked ${count > 1 ? `${count} penalty cards` : "a card"}.`;
      g.log = [g.message, ...g.log].slice(0, 8);
      g.currentPlayer = nextIndex(g.currentPlayer, g.direction, g.players.length);
    }

    emitRoom(room);
  }, AUTO_SKIP_MS);
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", {
    roomCode: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.token,
      name: player.name,
      connected: player.connected,
    })),
  });

  if (room.game) {
    room.players.forEach((player) => {
      if (!player.connected) return;
      io.to(player.socketId).emit("game:update", makeSnapshot(room, player.token));
    });
    scheduleAutoSkip(room);
  }
}

function removePlayer(room, token) {
  const index = room.players.findIndex((player) => player.token === token);
  if (index === -1) return;

  room.players.splice(index, 1);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === token) {
    room.hostId = room.players[0].token;
  }

  emitRoom(room);
}

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGIN } });

app.use(express.static(path.join(__dirname, "dist")));

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, token }, reply) => {
    const playerToken = cleanToken(token);
    const code = makeRoomCode();
    const player = { token: playerToken, name: cleanName(name, "Host"), socketId: socket.id, connected: true, disconnectTimer: null };
    const room = { code, hostId: playerToken, status: "lobby", players: [player], game: null, autoSkipTimer: null };
    rooms.set(code, room);
    socket.data.token = playerToken;
    socket.data.roomCode = code;
    socket.join(code);
    reply?.({ ok: true, roomCode: code, token: playerToken });
    emitRoom(room);
  });

  socket.on("room:join", ({ roomCode, name, token }, reply) => {
    const code = String(roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      reply?.({ ok: false, error: "Room not found." });
      return;
    }

    const playerToken = cleanToken(token);
    const existing = room.players.find((player) => player.token === playerToken);

    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.socketId = socket.id;
      existing.connected = true;
      if (name) existing.name = cleanName(name, existing.name);
      socket.data.token = playerToken;
      socket.data.roomCode = code;
      socket.join(code);
      reply?.({ ok: true, roomCode: code, token: playerToken });
      emitRoom(room);
      return;
    }

    if (room.status !== "lobby") {
      reply?.({ ok: false, error: "That game has already started." });
      return;
    }

    if (room.players.length >= 8) {
      reply?.({ ok: false, error: "That room is full." });
      return;
    }

    const player = {
      token: playerToken,
      name: cleanName(name, `Player ${room.players.length + 1}`),
      socketId: socket.id,
      connected: true,
      disconnectTimer: null,
    };
    room.players.push(player);
    socket.data.token = playerToken;
    socket.data.roomCode = code;
    socket.join(code);
    reply?.({ ok: true, roomCode: code, token: playerToken });
    emitRoom(room);
  });

  socket.on("room:start", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room || room.hostId !== socket.data.token || room.players.length < 2) return;
    room.status = "playing";
    room.game = buildGame(room.players);
    emitRoom(room);
  });

  socket.on("game:play", ({ roomCode, cardIndex, declaredSuit }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room?.game) return;
    applyCard(room.game, socket.data.token, cardIndex, declaredSuit);
    emitRoom(room);
  });

  socket.on("game:draw", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    const game = room?.game;
    if (!game || game.players[game.currentPlayer]?.id !== socket.data.token || game.winner) return;

    const count = game.pendingPenalty || 1;
    drawCards(game, game.currentPlayer, count);
    game.pendingPenalty = 0;
    game.message = count > 1 ? `${game.players[game.currentPlayer].name} picked ${count} penalty cards.` : `${game.players[game.currentPlayer].name} picked a card.`;
    game.log = [game.message, ...game.log].slice(0, 8);
    game.currentPlayer = nextIndex(game.currentPlayer, game.direction, game.players.length);
    emitRoom(room);
  });

  socket.on("game:kadi", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    const game = room?.game;
    if (!game || game.players[game.currentPlayer]?.id !== socket.data.token || game.winner) return;
    game.players[game.currentPlayer].saidKadi = true;
    game.message = `${game.players[game.currentPlayer].name} said Niko Kadi.`;
    game.log = [game.message, ...game.log].slice(0, 8);
    emitRoom(room);
  });

  socket.on("game:restart", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return;
    const isHost = room.hostId === socket.data.token;
    const isPostGame = Boolean(room.game?.winner);
    if (!isHost && !isPostGame) return;
    room.status = "lobby";
    room.game = null;
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const token = socket.data.token;
    if (!code || !token) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find((item) => item.token === token);
    if (!player || player.socketId !== socket.id) return;

    player.connected = false;
    emitRoom(room);

    player.disconnectTimer = setTimeout(() => {
      removePlayer(room, token);
    }, RECONNECT_GRACE_MS);
  });
});

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Kadi server running on port ${PORT}`);
});
