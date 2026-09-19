const SUITS = [
  { id: "hearts", label: "Hearts", icon: "♥", color: "red" },
  { id: "diamonds", label: "Diamonds", icon: "♦", color: "red" },
  { id: "clubs", label: "Clubs", icon: "♣", color: "black" },
  { id: "spades", label: "Spades", icon: "♠", color: "black" },
];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const ANSWERS = new Set(["A", "4", "5", "6", "7", "9", "10"]);
// Aces are wild/utility cards, not a genuine "answer" — they can't close a
// Question chain, and (see canWinWith) can't be a winning card either.
const QUESTION_CLOSING_RANKS = new Set(["4", "5", "6", "7", "9", "10"]);
const QUESTIONS = new Set(["8", "Q"]);
const PENALTY_DRAW = { 2: 2, 3: 3, JOK: 5 };
const INVALID_STARTS = new Set(["A", "2", "3", "8", "J", "Q", "K", "JOK"]);
const VALID_RANK_DECLARATIONS = new Set(RANKS);

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
    declaredRank: null,
    pendingPenalty: 0,
    winner: null,
    kadiWindow: null,
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

// Jokers have no real suit, but each one has a color, and that color
// becomes the requirement the same way "all red"/"all black" works for a
// double-Ace lock — e.g. if a red Joker is left on top when a penalty chain
// fizzles out, the next play just needs any red-suited card.
function jokerColor(card) {
  return card.id === "JOK-red" ? "red" : card.id === "JOK-black" ? "black" : null;
}

function activeSuit(game) {
  if (game.declaredSuit) return game.declaredSuit;
  const top = topCard(game);
  if (top.rank === "JOK") return jokerColor(top) ?? top.suit;
  return top.suit;
}

const RED_SUITS = new Set(["hearts", "diamonds"]);
const BLACK_SUITS = new Set(["spades", "clubs"]);
const VALID_SUIT_DECLARATIONS = new Set(["hearts", "diamonds", "clubs", "spades", "red", "black"]);

// A declared requirement can be one exact suit, or a whole color ("red" /
// "black") when an Ace locked in a color group instead of a single suit.
function suitSatisfies(cardSuit, requirement) {
  if (requirement === "red") return RED_SUITS.has(cardSuit);
  if (requirement === "black") return BLACK_SUITS.has(cardSuit);
  return cardSuit === requirement;
}

function canPlay(card, game) {
  // Aces are wild: playable on anything, at any time, penalty or not.
  if (card.rank === "A") return true;
  const top = topCard(game);
  // "Bomb for bomb": any Penalty Card (2, 3, or Joker) forwards a pending
  // penalty, not just a matching rank — their values stack.
  if (game.pendingPenalty > 0) return Boolean(PENALTY_DRAW[card.rank]);
  if (card.rank === "JOK") return top.rank === "2" || top.rank === "3" || top.rank === "JOK";
  // A double-Ace lock requires BOTH suit and exact rank (anything but an
  // Ace itself, which is already wild above).
  if (game.declaredRank) return card.rank === game.declaredRank && suitSatisfies(card.suit, activeSuit(game));
  return card.rank === top.rank || suitSatisfies(card.suit, activeSuit(game));
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
// several before closing out), or by another Question Card of the same
// RANK regardless of suit (8s pile on 8s the same way any other rank can be
// played as a set) — both extend the chain, anchored to the first card's
// suit/rank throughout, not whatever card came last. Then it closes with an
// Answer Card matching the first card's suit specifically. Greedily extends
// as far as possible — chaining sheds more cards, which is always at least
// as good as stopping early — before looking for the closing Answer Card.
function resolveQuestionChain(firstCard, restOfHand) {
  const chain = [firstCard];
  const usedIds = new Set([firstCard.id]);
  const suit = firstCard.suit;
  const rank = firstCard.rank;

  for (let guard = 0; guard < restOfHand.length; guard += 1) {
    const nextQuestion = restOfHand.find(
      (next) => !usedIds.has(next.id) && QUESTIONS.has(next.rank) && (next.suit === suit || next.rank === rank),
    );
    if (!nextQuestion) break;
    chain.push(nextQuestion);
    usedIds.add(nextQuestion.id);
  }

  const answerCard = restOfHand.find((next) => !usedIds.has(next.id) && QUESTION_CLOSING_RANKS.has(next.rank) && next.suit === suit) ?? null;
  return { chain, answerCard };
}

// Aces are wild/utility cards, never a legitimate way to close out a win
// even though they're still an Answer Card for ordinary matching purposes.
// J, K, and Penalty ranks (2, 3, Joker) were never winning cards either.
function isWinningRank(rank) {
  return rank !== "A" && (ANSWERS.has(rank) || QUESTIONS.has(rank));
}

function canWinWith(card, saidKadi) {
  if (!saidKadi) return false;
  // Reachable only once a play has already emptied the hand, and a Question
  // Card only reaches this point once its chain was closed by an Answer
  // Card (see applyCard) — so any (non-Ace) Answer or Question first card
  // qualifies.
  return isWinningRank(card.rank);
}

// A hand can be closed out in one move if it's either a bulk set of the
// same (non-Ace) Answer rank, or a single-suit run of Question Cards closed
// by exactly one Answer Card of that suit.
export function canGoOutWithHand(hand) {
  if (hand.length === 0) return false;

  if (hand.every((c) => c.rank === hand[0].rank) && ANSWERS.has(hand[0].rank) && hand[0].rank !== "A") {
    return true;
  }

  const suit = hand[0].suit;
  if (hand.every((c) => c.suit === suit)) {
    const answerCount = hand.filter((c) => QUESTION_CLOSING_RANKS.has(c.rank)).length;
    const questionCount = hand.filter((c) => QUESTIONS.has(c.rank)).length;
    if (answerCount === 1 && questionCount === hand.length - 1) return true;
  }

  return false;
}

// You may only announce "Niko Kadi" in the window right after the play that
// leaves your hand one move from winning, and only until the next player's
// turn concludes. Miss it and you draw a penalty card instead. Called
// whenever a player's turn is concluding (about to hand off to nextPlayerId)
// — first resolves any window that was watching this player, then opens a
// fresh one if this player's own hand just became winnable.
function settleKadiWindow(game, actingPlayerId, nextPlayerId) {
  if (game.kadiWindow && game.kadiWindow.watchPlayerId === actingPlayerId) {
    const holderIndex = game.players.findIndex((p) => p.id === game.kadiWindow.holderId);
    const holder = holderIndex >= 0 ? game.players[holderIndex] : null;
    if (holder && !holder.saidKadi) {
      drawCards(game, holderIndex, 1);
      game.log = [`${holder.name} missed the Niko Kadi window and picked a card.`, ...game.log].slice(0, 8);
    }
    game.kadiWindow = null;
  }

  const actingPlayer = game.players.find((p) => p.id === actingPlayerId);
  if (actingPlayer && !actingPlayer.saidKadi && canGoOutWithHand(actingPlayer.hand)) {
    game.kadiWindow = { holderId: actingPlayerId, watchPlayerId: nextPlayerId };
  } else if (game.kadiWindow?.holderId === actingPlayerId) {
    game.kadiWindow = null;
  }
}

// Every place that hands the turn to a new player must go through here so
// the Kadi-declaration window is settled at the exact moment it changes,
// rather than lazily on the next request (which could race a second
// window opening before the first was ever penalized).
export function advanceTurn(game, actingPlayerId, nextPlayerIndex) {
  // An even Kickback count keeps the turn with the same player (0 steps) —
  // that's not a real turn conclusion, so don't settle any Kadi window over
  // it; the player is about to act again, not handing off to anyone.
  if (nextPlayerIndex === game.currentPlayer) return;
  settleKadiWindow(game, actingPlayerId, game.players[nextPlayerIndex]?.id ?? null);
  game.currentPlayer = nextPlayerIndex;
}

// cardIndices is either a single index (legacy) or an array of indices the
// player selected — for a non-Question rank, every extra index beyond the
// first must share the first card's rank (the player's own choice of how
// many of a same-rank set to commit to this move, not an automatic
// "play everything" grab); anything else is dropped rather than trusted.
export function applyCard(game, playerId, cardIndices, declaredSuit, declaredRank) {
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex !== game.currentPlayer || game.winner) return;

  const player = game.players[playerIndex];
  const indices = [...new Set(Array.isArray(cardIndices) ? cardIndices : [cardIndices])];
  const requested = indices.map((index) => player.hand[index]).filter(Boolean);
  const card = requested[0];
  if (!card) return;

  if (!canPlay(card, game)) {
    if (game.pendingPenalty > 0) {
      // Can't dodge a pending bomb by attempting an illegal card — that's
      // not a cheaper way out than just drawing. Same consequence as
      // game:draw: pick up the full penalty and it's fully resolved, not
      // silently carried over to whoever's turn is next.
      const owed = game.pendingPenalty;
      drawCards(game, playerIndex, owed);
      game.pendingPenalty = 0;
      game.message = `${player.name} couldn't forward the penalty and picked ${owed} cards.`;
      game.log = [`${player.name} tried ${cardName(card)} illegally and picked ${owed}.`, ...game.log].slice(0, 8);
    } else {
      drawCards(game, playerIndex, 1);
      game.message = `${player.name} played an invalid card and picked one.`;
      game.log = [`${player.name} tried ${cardName(card)} illegally.`, ...game.log].slice(0, 8);
    }
    advanceTurn(game, playerId, nextIndex(game.currentPlayer, game.direction, game.players.length));
    return;
  }

  let playedCards = [card];
  let answerCard = null;
  let answerCards = [];

  if (QUESTIONS.has(card.rank)) {
    let chain;
    if (requested.length > 1) {
      // Player built their own chain + closer(s) — validate it rather than
      // trusting it: each extra Question card must share the first card's
      // suit OR its rank (piling same-rank Questions regardless of suit is
      // fine, same as any other rank). The closer can be a bulk same-rank
      // set too (e.g. three 10s closing three same-rank Qs), the same way
      // bulk plays work elsewhere — but at least one of them must actually
      // match the first card's suit, since that's what closes the exchange;
      // extra same-rank closers of other suits just ride along.
      const rest = requested.slice(1);
      const uniqueOk = new Set(requested.map((c) => c.id)).size === requested.length;
      const chainPart = rest.filter((c) => QUESTIONS.has(c.rank) && (c.suit === card.suit || c.rank === card.rank));
      const closerCandidates = rest.filter((c) => QUESTION_CLOSING_RANKS.has(c.rank));
      const noStrays = chainPart.length + closerCandidates.length === rest.length;
      const closersSameRank = closerCandidates.length > 0 && closerCandidates.every((c) => c.rank === closerCandidates[0].rank);
      const closersHaveSuitMatch = closerCandidates.some((c) => c.suit === card.suit);
      const valid = uniqueOk && noStrays && closerCandidates.length >= 1 && closersSameRank && closersHaveSuitMatch;

      chain = valid ? [card, ...chainPart] : [card];
      answerCards = valid ? closerCandidates : [];
    } else {
      // Single click, no manual choice made — auto-resolve as before.
      const restOfHand = player.hand.filter((_, index) => index !== indices[0]);
      const auto = resolveQuestionChain(card, restOfHand);
      chain = auto.chain;
      answerCards = auto.answerCard ? [auto.answerCard] : [];
    }

    if (answerCards.length === 0) {
      // The Question Card still goes onto the pile even unanswered — the
      // asker just draws a penalty card instead of closing the exchange,
      // and the (still-open) question sits on top for the next player.
      player.hand = player.hand.filter((h) => h.id !== card.id);
      game.discardPile.push(card);
      game.declaredSuit = null;
      game.declaredRank = null;
      drawCards(game, playerIndex, 1);
      game.message = `${player.name} played ${cardName(card)} but had no answer and picked a card.`;
      game.log = [game.message, ...game.log].slice(0, 8);
      advanceTurn(game, playerId, nextIndex(game.currentPlayer, game.direction, game.players.length));
      return;
    }
    answerCard = answerCards[0];
    playedCards = [...chain, ...answerCards];
  } else if (PENALTY_DRAW[card.rank]) {
    // Bombs (2, 3, Joker) can be piled together across different ranks too,
    // not just an exact match — the same "bomb for bomb" flexibility that
    // already applies turn-to-turn, now available within one move if the
    // active player chooses to combine what they hold.
    const chosenBombs = requested.slice(1).filter((next) => PENALTY_DRAW[next.rank] && next.id !== card.id);
    const uniqueBombs = chosenBombs.filter((next, i) => chosenBombs.findIndex((c) => c.id === next.id) === i);
    playedCards = [card, ...uniqueBombs];
  } else {
    // Only the cards the player actually selected, same rank as the first —
    // their choice of how many to commit, not an automatic full sweep.
    const chosenSiblings = requested.slice(1).filter((next) => next.rank === card.rank && next.id !== card.id);
    const uniqueSiblings = chosenSiblings.filter((next, i) => chosenSiblings.findIndex((c) => c.id === next.id) === i);
    playedCards = [card, ...uniqueSiblings];
  }

  const playedIds = new Set(playedCards.map((played) => played.id));
  const hadSaidKadi = player.saidKadi;
  const effectiveCard = answerCard ?? card;
  const previousDeclaredRank = game.declaredRank;

  player.hand = player.hand.filter((handCard) => !playedIds.has(handCard.id));
  player.saidKadi = false;
  game.discardPile.push(...playedCards);
  game.declaredSuit = null;
  game.declaredRank = null;

  let steps = 1;
  let direction = game.direction;
  let pendingPenalty = game.pendingPenalty;
  const questionsInChain = playedCards.length - answerCards.length;
  const answerText = answerCards.length > 1 ? answerCards.map(cardName).join(", ") : cardName(answerCard);
  let message = answerCard
    ? questionsInChain > 1
      ? `${player.name} chained ${questionsInChain} questions and answered with ${answerText}.`
      : `${player.name} asked ${cardName(card)} and answered with ${answerText}.`
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
    // Each King is a step backward relative to the direction at the time it
    // resolves, alternating: 1 flips direction and steps once in the new
    // (reversed) direction — the standard single reversal, handing the
    // turn to whoever was behind you. 2 flips it back again and steps back
    // again too, netting zero displacement — the turn returns to you, not
    // just "direction unchanged, next player as normal". Odd counts behave
    // like a single reversal; even counts keep the turn with the player.
    if (playedCards.length % 2 === 1) {
      direction = -direction;
      steps = 1;
    } else {
      steps = 0;
    }
    message = playedCards.length > 1
      ? playedCards.length % 2 === 0
        ? `${player.name} played ${playedCards.length} Kickbacks and keeps the turn.`
        : `${player.name} played ${playedCards.length} Kickbacks.`
      : `${player.name} kicked play back.`;
  } else if (PENALTY_DRAW[card.rank]) {
    // Sum each played bomb's own value rather than assuming they're all the
    // same rank — a mixed pile (e.g. a 2 and a 3 together) adds 2+3, not
    // 2*2.
    pendingPenalty += playedCards.reduce((sum, played) => sum + PENALTY_DRAW[played.rank], 0);
    message = `${player.name} passed a ${pendingPenalty}-card penalty.`;
  } else if (effectiveCard.rank === "A") {
    const wasEvadingBomb = game.pendingPenalty > 0;
    const isSpecialAcePlay = playedCards.length >= 2 || playedCards.some((played) => played.id === "A-spades");

    if (wasEvadingBomb) {
      pendingPenalty = 0;
      message = `${player.name} blocked the penalty with an Ace.`;
    }

    if (wasEvadingBomb && !isSpecialAcePlay) {
      // Using an Ace defensively costs it some of its declaring power. A
      // regular Ace loses the suit-declare entirely when it's the thing
      // canceling a bomb — the requirement instead carries over from the
      // last Penalty Card (its suit, or its color if it was a Joker), the
      // same way a Joker left on top would set the requirement itself.
      const lastBomb = game.discardPile[game.discardPile.length - 1 - playedCards.length];
      game.declaredSuit = lastBomb.rank === "JOK" ? (jokerColor(lastBomb) ?? lastBomb.suit) : lastBomb.suit;
    } else {
      game.declaredSuit = VALID_SUIT_DECLARATIONS.has(declaredSuit) ? declaredSuit : effectiveCard.suit;
    }

    // The Ace of Spades is "special" on its own; two or more Aces played
    // together (any suits) carry the same power. Either way it locks both
    // suit AND rank — a much stricter requirement than a lone Ace's
    // suit-only lock. But evading a bomb costs a special Ace its rank-lock
    // power too, even though it keeps the suit-declare; and it can only
    // lock a rank backed by a card still in the player's own hand anyway —
    // otherwise they could lock something nobody (including themselves)
    // can ever satisfy.
    if (isSpecialAcePlay && !wasEvadingBomb) {
      const rankChoice = VALID_RANK_DECLARATIONS.has(declaredRank) ? declaredRank : null;
      const ownsMatchingCard = rankChoice
        && player.hand.some((held) => held.rank === rankChoice && suitSatisfies(held.suit, game.declaredSuit));

      if (ownsMatchingCard) {
        game.declaredRank = rankChoice;
        message = playedCards.length >= 2
          ? `${player.name} played ${playedCards.length} Aces and locked suit and rank.`
          : `${player.name} played the Ace of Spades and locked suit and rank.`;
      } else {
        message = playedCards.length >= 2
          ? `${player.name} played ${playedCards.length} Aces (suit only — no matching card in hand to back a rank lock).`
          : `${player.name} played the Ace of Spades (suit only — no matching card in hand to back a rank lock).`;
      }
    } else if (isSpecialAcePlay && wasEvadingBomb) {
      message = playedCards.length >= 2
        ? `${player.name} blocked the penalty with ${playedCards.length} Aces (suit only — no rank lock while evading).`
        : `${player.name} blocked the penalty with the Ace of Spades (suit only — no rank lock while evading).`;
    } else if (!wasEvadingBomb && previousDeclaredRank) {
      // A lone Ace can only change the suit of an existing double-lock —
      // the rank stays locked until it's fulfilled or re-locked by a fresh
      // double-Ace play.
      game.declaredRank = previousDeclaredRank;
      message = `${player.name} changed the suit, but the rank stays locked.`;
    }
  } else if (game.pendingPenalty > 0) {
    pendingPenalty = 0;
  }

  game.direction = direction;
  game.pendingPenalty = pendingPenalty;

  if (player.hand.length === 0) {
    if (canWinWith(card, hadSaidKadi)) {
      // A player cannot win while anyone else is sitting cardless — the
      // play still stands (it was a legitimate winning combo), it just
      // doesn't end the game yet.
      const anyoneElseCardless = game.players.some((p) => p.id !== playerId && p.hand.length === 0);
      if (!anyoneElseCardless) {
        game.winner = player.name;
        game.message = `${player.name} wins Kadi.`;
        game.log = [`${player.name} went out with ${playedCards.map(cardName).join(" then ")}.`, ...game.log].slice(0, 8);
        return;
      }
      game.message = `${player.name} would win, but nobody can win while another player is cardless.`;
      game.log = [game.message, ...game.log].slice(0, 8);
      advanceTurn(game, playerId, nextIndex(game.currentPlayer, direction, game.players.length, steps));
      return;
    }

    if (!isWinningRank(card.rank)) {
      // J, K, 2, 3, Joker, and Aces were never winning cards, so there's no
      // "failed win attempt" to undo here — the play just stands normally
      // and the player is now cardless (blocking anyone from winning until
      // they draw back in).
      game.message = message;
      game.log = [message, ...game.log].slice(0, 8);
      advanceTurn(game, playerId, nextIndex(game.currentPlayer, direction, game.players.length, steps));
      return;
    }

    // A genuine winning-type card (Answer/Question), but Niko Kadi wasn't
    // said in time — revert so they can try again properly.
    player.hand.push(...playedCards);
    game.discardPile = game.discardPile.slice(0, -playedCards.length);
    game.message = "You must say Niko Kadi on the previous round and finish with a winning card.";
    game.log = [`${player.name} could not win yet.`, ...game.log].slice(0, 8);
    return;
  }

  game.message = message;
  game.log = [message, ...game.log].slice(0, 8);
  advanceTurn(game, playerId, nextIndex(game.currentPlayer, direction, game.players.length, steps));
}
