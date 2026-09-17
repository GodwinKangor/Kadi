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

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function cleanName(name, fallback) {
  return String(name || "").trim().slice(0, 18) || fallback;
}

export function cleanToken(token) {
  const value = String(token || "").trim().slice(0, 64);
  return value || crypto.randomUUID();
}

function cardName(card) {
  if (!card) return "";
  if (card.rank === "JOK") return "Joker";
  const suit = SUITS.find((item) => item.id === card.suit);
  return `${card.rank}${suit?.icon ?? ""}`;
}

export function buildGame(players) {
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

export function nextIndex(current, direction, total, steps = 1) {
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

export function drawCards(game, playerIndex, count) {
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

export function applyCard(game, playerId, cardIndex, declaredSuit) {
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
