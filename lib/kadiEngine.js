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
  // "Bomb for bomb": any Penalty Card (2, 3, or Joker) forwards a pending
  // penalty, not just a matching rank — their values stack. An Ace still
  // cancels the whole accumulated penalty outright.
  if (game.pendingPenalty > 0) return Boolean(PENALTY_DRAW[card.rank]) || card.rank === "A";
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

// A Question Card can be answered by another Question Card of the same
// suit (which itself then needs answering, so a player can chain through
// several before closing out), or directly by an Answer Card of the same
// suit. Greedily extends through every same-suit Question Card available —
// chaining sheds more cards, which is always at least as good as stopping
// early — then looks for the closing Answer Card.
function resolveQuestionChain(firstCard, restOfHand) {
  const chain = [firstCard];
  const usedIds = new Set([firstCard.id]);
  const suit = firstCard.suit;

  for (let guard = 0; guard < restOfHand.length; guard += 1) {
    const nextQuestion = restOfHand.find(
      (next) => !usedIds.has(next.id) && QUESTIONS.has(next.rank) && next.suit === suit,
    );
    if (!nextQuestion) break;
    chain.push(nextQuestion);
    usedIds.add(nextQuestion.id);
  }

  const answerCard = restOfHand.find((next) => !usedIds.has(next.id) && ANSWERS.has(next.rank) && next.suit === suit) ?? null;
  return { chain, answerCard };
}

function canWinWith(card, saidKadi) {
  if (!saidKadi) return false;
  // Reachable only once a play has already emptied the hand, and a Question
  // Card only reaches this point once its chain was closed by an Answer
  // Card (see applyCard) — so any Answer or Question first card qualifies.
  return ANSWERS.has(card.rank) || QUESTIONS.has(card.rank);
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

  let playedCards = [card];
  let answerCard = null;

  if (QUESTIONS.has(card.rank)) {
    const restOfHand = player.hand.filter((_, index) => index !== cardIndex);
    const chainResult = resolveQuestionChain(card, restOfHand);
    if (!chainResult.answerCard) {
      drawCards(game, playerIndex, 1);
      game.message = "A Question card needs an answer card in the same move.";
      game.log = [`${player.name} had no answer for ${cardName(card)} and picked one.`, ...game.log].slice(0, 8);
      game.currentPlayer = nextIndex(game.currentPlayer, game.direction, game.players.length);
      return;
    }
    answerCard = chainResult.answerCard;
    playedCards = [...chainResult.chain, answerCard];
  } else {
    // Every other card of the exact same rank rides along in this move too
    // (a set of 5s, several 2s, several Jacks, ...); their effects stack.
    const siblings = player.hand.filter((next, index) => index !== cardIndex && next.rank === card.rank);
    playedCards = [card, ...siblings];
  }

  const playedIds = new Set(playedCards.map((played) => played.id));
  const hadSaidKadi = player.saidKadi;
  const effectiveCard = answerCard ?? card;

  player.hand = player.hand.filter((handCard) => !playedIds.has(handCard.id));
  player.saidKadi = false;
  game.discardPile.push(...playedCards);
  game.declaredSuit = null;

  let steps = 1;
  let direction = game.direction;
  let pendingPenalty = game.pendingPenalty;
  let message = answerCard
    ? playedCards.length > 2
      ? `${player.name} chained ${playedCards.length - 1} questions and answered with ${cardName(answerCard)}.`
      : `${player.name} asked ${cardName(card)} and answered with ${cardName(answerCard)}.`
    : playedCards.length > 1
      ? `${player.name} played ${playedCards.length}× ${card.rank}.`
      : `${player.name} played ${cardName(card)}.`;

  if (card.rank === "J") {
    // Each Jack skips one more player.
    steps = playedCards.length + 1;
    message = playedCards.length > 1
      ? `${player.name} jumped ${playedCards.length} players.`
      : `${player.name} jumped the next player.`;
  } else if (card.rank === "K") {
    // Each King flips direction again, so an even count cancels out.
    if (playedCards.length % 2 === 1) direction = -direction;
    message = playedCards.length > 1
      ? `${player.name} played ${playedCards.length} Kickbacks.`
      : `${player.name} kicked play back.`;
  } else if (PENALTY_DRAW[card.rank]) {
    pendingPenalty += PENALTY_DRAW[card.rank] * playedCards.length;
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
    if (canWinWith(card, hadSaidKadi)) {
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
