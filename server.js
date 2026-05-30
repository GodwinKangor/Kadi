import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;

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

function cardName(card) {
  if (!card) return "";
  if (card.rank === "JOK") return "Joker";
  const suit = SUITS.find((item) => item.id === card.suit);
  return `${card.rank}${suit?.icon ?? ""}`;
}

function buildGame(players) {
  let deck = shuffle(createDeck());
  const gamePlayers = players.map((player) => ({
    id: player.id,
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

function activeSuit(game) {
  return game.declaredSuit ?? topCard(game).suit;
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

  return {
    roomCode: room.code,
    hostId: room.hostId,
    viewerId,
    viewerIndex,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      saidKadi: player.saidKadi,
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

function emitRoom(room) {
  io.to(room.code).emit("room:update", {
    roomCode: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players,
  });

  if (room.game) {
    room.players.forEach((player) => {
      io.to(player.id).emit("game:update", makeSnapshot(room, player.id));
    });
  }
}

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "dist")));

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, reply) => {
    const code = makeRoomCode();
    const player = { id: socket.id, name: cleanName(name, "Host") };
    const room = { code, hostId: socket.id, status: "lobby", players: [player], game: null };
    rooms.set(code, room);
    socket.join(code);
    reply?.({ ok: true, roomCode: code, playerId: socket.id });
    emitRoom(room);
  });

  socket.on("room:join", ({ roomCode, name }, reply) => {
    const code = String(roomCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      reply?.({ ok: false, error: "Room not found." });
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

    const player = { id: socket.id, name: cleanName(name, `Player ${room.players.length + 1}`) };
    room.players.push(player);
    socket.join(code);
    reply?.({ ok: true, roomCode: code, playerId: socket.id });
    emitRoom(room);
  });

  socket.on("room:start", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room || room.hostId !== socket.id || room.players.length < 2) return;
    room.status = "playing";
    room.game = buildGame(room.players);
    emitRoom(room);
  });

  socket.on("game:play", ({ roomCode, cardIndex, declaredSuit }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room?.game) return;
    applyCard(room.game, socket.id, cardIndex, declaredSuit);
    emitRoom(room);
  });

  socket.on("game:draw", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    const game = room?.game;
    if (!game || game.players[game.currentPlayer]?.id !== socket.id || game.winner) return;

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
    if (!game || game.players[game.currentPlayer]?.id !== socket.id || game.winner) return;
    game.players[game.currentPlayer].saidKadi = true;
    game.message = `${game.players[game.currentPlayer].name} said Niko Kadi.`;
    game.log = [game.message, ...game.log].slice(0, 8);
    emitRoom(room);
  });

  socket.on("game:restart", ({ roomCode }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room || room.hostId !== socket.id) return;
    room.status = "lobby";
    room.game = null;
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    rooms.forEach((room, code) => {
      const index = room.players.findIndex((player) => player.id === socket.id);
      if (index === -1) return;

      room.players.splice(index, 1);
      if (room.players.length === 0) {
        rooms.delete(code);
        return;
      }

      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }

      if (room.status === "lobby") {
        emitRoom(room);
      }
    });
  });
});

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Kadi server running on port ${PORT}`);
});
