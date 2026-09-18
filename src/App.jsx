import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = "/api/kadi";
const POLL_MS = 1500;
const TOKEN_KEY = "kadi:token";
const SESSION_KEY = "kadi:session";

async function callApi(action, payload) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    const networkError = new Error("Can't reach the room server.");
    networkError.isNetworkError = true;
    throw networkError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "Request failed.");
  }
  return data;
}

function getPlayerToken() {
  try {
    let token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = window.crypto?.randomUUID ? window.crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    return `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(roomCode, name) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, name }));
  } catch {
    // ignore storage failures (private browsing, quota, etc.)
  }
}

function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

const SUITS = [
  { id: "hearts", label: "Hearts", icon: "♥", color: "red" },
  { id: "diamonds", label: "Diamonds", icon: "♦", color: "red" },
  { id: "clubs", label: "Clubs", icon: "♣", color: "black" },
  { id: "spades", label: "Spades", icon: "♠", color: "black" },
];

const QUESTIONS = new Set(["8", "Q"]);
const ANSWERS = new Set(["A", "4", "5", "6", "7", "9", "10"]);
const QUESTION_CLOSING_RANKS = new Set(["4", "5", "6", "7", "9", "10"]);
const PENALTY_DRAW = { 2: 2, 3: 3, JOK: 5 };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function getInitialRoomCode() {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]+)/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function cardSuit(card) {
  return SUITS.find((suit) => suit.id === card?.suit);
}

function cardName(card) {
  if (!card) return "";
  if (card.rank === "JOK") return "Joker";
  const suit = cardSuit(card);
  return `${card.rank}${suit?.icon ?? ""}`;
}

function cardType(card) {
  if (card.id === "A-spades") return "Special Ace";
  if (card.rank === "J") return "Jump";
  if (card.rank === "K") return "Kickback";
  if (QUESTIONS.has(card.rank)) return "Question";
  if (PENALTY_DRAW[card.rank]) return `Penalty +${PENALTY_DRAW[card.rank]}`;
  if (ANSWERS.has(card.rank)) return "Answer";
  return "Card";
}

function topCard(game) {
  return game.discardPile[game.discardPile.length - 1];
}

function activeSuit(game) {
  return game.declaredSuit ?? topCard(game)?.suit;
}

const SUIT_GROUPS = [
  { id: "red", label: "All Red", icon: "♥♦", color: "red" },
  { id: "black", label: "All Black", icon: "♠♣", color: "black" },
];

function suitRequirementDisplay(requirement) {
  return SUITS.find((suit) => suit.id === requirement) ?? SUIT_GROUPS.find((group) => group.id === requirement) ?? null;
}

const RED_SUIT_IDS = new Set(["hearts", "diamonds"]);
const BLACK_SUIT_IDS = new Set(["spades", "clubs"]);

function suitSatisfiesClient(cardSuit, requirement) {
  if (requirement === "red") return RED_SUIT_IDS.has(cardSuit);
  if (requirement === "black") return BLACK_SUIT_IDS.has(cardSuit);
  return cardSuit === requirement;
}

// Lets a player type a declaration instead of clicking a button — "h",
// "hearts", "red", etc. Prefix-matched, case-insensitive, first letter is
// enough for every option since h/d/c/s/r/b are all distinct.
function normalizeSuitInput(text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const match = [...SUITS, ...SUIT_GROUPS].find((option) => option.id.startsWith(t) || option.label.toLowerCase().startsWith(t));
  return match?.id ?? null;
}

function Card({ card, hidden = false, disabled = false, selected = false, selectable = false, style, onClick }) {
  const suit = cardSuit(card);
  const className = [
    "card",
    suit?.color === "red" ? "red" : "black",
    hidden ? "hidden" : "",
    disabled ? "disabled" : "",
    selected ? "selected" : "",
    selectable ? "selectable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} type="button" style={style} disabled={disabled || hidden} onClick={onClick}>
      {hidden ? (
        <span className="card-back">♠</span>
      ) : (
        <>
          <span className="card-rank">{card.rank}</span>
          <span className="card-suit">{suit?.icon ?? "★"}</span>
          <span className="card-kind">{cardType(card)}</span>
        </>
      )}
    </button>
  );
}

// A gentle curved fan: cards pivot from below, so edges rotate outward and
// droop slightly relative to the center card, which sits highest.
function fanCardStyle(index, total, state) {
  const mid = (total - 1) / 2;
  const angleStep = total > 1 ? Math.min(9, 50 / total) : 0;
  const angle = total > 1 ? (index - mid) * angleStep : 0;
  const arcLift = total > 1 ? Math.abs(index - mid) * 2.2 : 0;
  const extraLift = state === "selected" ? -26 : state === "selectable" ? -8 : 0;
  return {
    transform: `translateY(${arcLift + extraLift}px) rotate(${angle}deg)`,
    zIndex: state === "selected" ? 50 : index,
  };
}

// Deterministic color per player so avatars stay visually distinct and
// stable across polls without needing real photos.
function avatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 46%, 34%)`;
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, active }) {
  return (
    <div className="avatar-wrap">
      <div className="avatar" style={{ background: avatarColor(name || "?") }}>
        {initialsFor(name || "?")}
      </div>
      {active && <span className="turn-flag">Turn</span>}
    </div>
  );
}

function ConnectionBanner({ status, onRetry }) {
  if (status === "connected") return null;
  const copy = {
    connecting: "Connecting to room server…",
    reconnecting: "Connection lost — reconnecting…",
    failed: "Can't reach the room server.",
  }[status];

  return (
    <div className={`connection-banner ${status}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>{copy}</span>
      {status === "failed" && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

function Opponent({ player, active }) {
  const away = player.connected === false;
  return (
    <section className={`opponent ${active ? "active" : ""}`} aria-label={`${player.name} status`}>
      <Avatar name={player.name} active={active} />
      <strong className="opponent-name">{player.name}</strong>
      <span className={`opponent-status ${away ? "away" : player.saidKadi ? "kadi" : ""}`}>
        {away ? "Reconnecting…" : player.saidKadi ? "Niko Kadi" : "Waiting"}
      </span>
      <div className="mini-hand" aria-label={`${player.hand.length} cards`}>
        {player.hand.slice(0, 8).map((card) => (
          <Card key={card.id} card={card} hidden />
        ))}
      </div>
      <b className="opponent-count">{player.hand.length} cards</b>
    </section>
  );
}

function SetupScreen({ submitting, error, initialRoomCode, connectionStatus, onRetry, onCreate, onJoin }) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const hasInvite = Boolean(initialRoomCode);

  return (
    <main className="setup-shell felt">
      <section className="setup-panel" aria-label="Room setup">
        <div className="setup-heading">
          <p>Kadi</p>
          <h1>{hasInvite ? "Join the room" : "Create or join"}</h1>
        </div>

        <ConnectionBanner status={connectionStatus} onRetry={onRetry} />

        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={18} placeholder="e.g. Godwin" />
        </label>

        <div className="room-actions">
          {!hasInvite && (
            <button className="start-button" type="button" disabled={submitting} onClick={() => onCreate(name)}>
              Create room
            </button>
          )}

          <label className="field">
            <span>Room code</span>
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              maxLength={8}
              placeholder="ABCDE"
            />
          </label>

          <button className="start-button secondary" type="button" disabled={submitting || !roomCode.trim()} onClick={() => onJoin(roomCode, name)}>
            Join room
          </button>
        </div>

        {error && <p className="error-note">{error}</p>}
      </section>
    </main>
  );
}

function LobbyScreen({ room, viewerId, connectionStatus, onRetry, onStart, onLeave }) {
  const isHost = room.hostId === viewerId;
  const shareLink = `${window.location.origin}/room/${room.roomCode}`;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard?.writeText(shareLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="setup-shell felt">
      <section className="setup-panel lobby-panel" aria-label="Room lobby">
        <div className="setup-heading">
          <p>Room {room.roomCode}</p>
          <h1>Waiting room</h1>
        </div>

        <ConnectionBanner status={connectionStatus} onRetry={onRetry} />

        <div className="invite-box">
          <span>Invite link</span>
          <strong>{shareLink}</strong>
          <button type="button" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <div className="player-list">
          {room.players.map((player) => (
            <div className="player-row" key={player.id}>
              <strong>{player.name}</strong>
              <span>
                {player.connected === false ? "Reconnecting…" : player.id === room.hostId ? "Host" : "Joined"}
              </span>
            </div>
          ))}
        </div>

        <div className="lobby-actions">
          <button className="start-button secondary" type="button" onClick={onLeave}>
            Leave
          </button>
          <button className="start-button" type="button" disabled={!isHost || room.players.length < 2} onClick={onStart}>
            Start game
          </button>
        </div>

        {!isHost && <p className="connection-note">The host will start once everyone has joined.</p>}
        {isHost && room.players.length < 2 && <p className="connection-note">Share the link or room code with at least one friend.</p>}
      </section>
    </main>
  );
}

function GameScreen({ game, viewerId, connectionStatus, onRetry, onPlay, onDraw, onKadi, onRestart }) {
  const you = game.players.find((player) => player.id === viewerId);
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const currentPlayer = game.players[game.currentPlayer];
  const currentSuit = suitRequirementDisplay(activeSuit(game));
  const yourTurn = currentPlayer?.id === viewerId && !game.winner;
  // null = no explicit declaration made this turn. The server already
  // falls back to the played Ace's own suit / no rank lock when nothing
  // valid is sent, so we must NOT carry a stale pick (e.g. "hearts" left
  // over from an earlier turn) into a play where the player never touched
  // the picker — that would silently override the card's own suit.
  const [selectedSuit, setSelectedSuit] = useState(null);
  const [selectedRank, setSelectedRank] = useState(null);
  const [suitText, setSuitText] = useState("");

  function handleSuitTextChange(value) {
    setSuitText(value);
    const match = normalizeSuitInput(value);
    if (match) setSelectedSuit(match);
  }

  // Cards the player has picked for this move — lets them choose whether to
  // follow with other same-rank cards or not, rather than always sweeping
  // every matching card into the play automatically.
  const [selection, setSelection] = useState([]);

  // Leaving your own turn (played, drew, got auto-skipped, ...) always
  // clears any half-made selection so it can't linger stale into a future
  // turn.
  useEffect(() => {
    if (!yourTurn) setSelection([]);
  }, [yourTurn]);

  function playCards(ids) {
    const indices = ids.map((id) => you.hand.findIndex((c) => c.id === id)).filter((index) => index !== -1);
    if (indices.length === 0) return;
    onPlay(indices, selectedSuit, selectedRank);
    setSelection([]);
    setSelectedSuit(null);
    setSelectedRank(null);
    setSuitText("");
  }

  // Whether `card` can be added to a same-rank set (anchor is a plain card)
  // or a Question chain (selected is the cards chosen so far, anchor =
  // selected[0]): another Question card can pile on by matching the
  // anchor's suit (the original chain rule) OR its rank (8s pile on 8s
  // regardless of suit, same as any other rank set). A closing Answer card
  // can be a bulk same-rank set too (e.g. three 10s), same as any other
  // rank — but at least one of them must match the anchor's suit, since
  // that's what actually resolves the exchange; once one does, further
  // same-rank closers of other suits are free to ride along.
  function matchesSelectionMode(selected, card) {
    const anchor = selected[0];
    if (QUESTIONS.has(anchor.rank)) {
      const sameSuit = card.suit === anchor.suit;
      if (QUESTIONS.has(card.rank)) return sameSuit || card.rank === anchor.rank;
      if (!QUESTION_CLOSING_RANKS.has(card.rank)) return false;
      const existingCloser = selected.find((c) => QUESTION_CLOSING_RANKS.has(c.rank));
      return existingCloser ? card.rank === existingCloser.rank : sameSuit;
    }
    // Bombs (2, 3, Joker) pile by category, not just exact rank - the same
    // "bomb for bomb" flexibility available within one move.
    if (PENALTY_DRAW[anchor.rank]) return Boolean(PENALTY_DRAW[card.rank]);
    return anchor.rank === card.rank;
  }

  function toggleCard(card) {
    const selectedCards = selection.map((id) => you.hand.find((c) => c.id === id)).filter(Boolean);
    if (selectedCards.length > 0 && matchesSelectionMode(selectedCards, card)) {
      setSelection((current) => (current.includes(card.id) ? current.filter((id) => id !== card.id) : [...current, card.id]));
      return;
    }

    if (QUESTIONS.has(card.rank)) {
      const candidateCount = you.hand.filter((c) => c.id !== card.id && matchesSelectionMode([card], c)).length;
      if (candidateCount === 0) {
        playCards([card.id]); // nothing to build a chain from - let auto-resolve draw if it truly has no answer
      } else {
        setSelection([card.id]); // has same-suit candidates - offer the choice of chain + closer
      }
      return;
    }

    const siblingCount = you.hand.filter((c) => matchesSelectionMode([card], c) || c.id === card.id).length;
    if (card.rank !== "A" && siblingCount <= 1) {
      playCards([card.id]); // nothing to decide - no suit to pick, no siblings to add - just play it
    } else {
      // Aces always pause here even solo, so there's a chance to pick a
      // suit (and rank, for the Ace of Spades) before the play goes out;
      // same-rank sets pause so the player can choose how many to include.
      setSelection([card.id]);
    }
  }

  const top = topCard(game);
  // The declare window is open on the *next* player's turn, right after you
  // played the card that leaves you one move from winning — not your own
  // turn, since by then play has already moved on.
  const canDeclareKadi = Boolean(you) && game.kadiWindowHolderId === viewerId && !you.saidKadi && !game.winner;

  // Driven by what's actually selected right now, not a hypothetical — the
  // Ace of Spades is special alone, two-or-more Aces together carry the
  // same suit+rank-lock power, and it's the player's own choice which of
  // those they've committed to for this move.
  const selectedCards = selection.map((id) => you?.hand.find((card) => card.id === id)).filter(Boolean);
  const isAceSelection = selectedCards.length > 0 && selectedCards.every((card) => card.rank === "A");
  const showRankPicker = isAceSelection && (selectedCards.length >= 2 || selectedCards.some((card) => card.id === "A-spades"));
  // The server only honors a rank lock backed by a card still in hand after
  // the Ace(s) are played — so only offer ranks that would actually lock,
  // rather than letting the player pick something that silently no-ops.
  const remainingHandForLock = you?.hand.filter((card) => !selection.includes(card.id)) ?? [];
  const lockableRanks = RANKS.filter((rank) =>
    remainingHandForLock.some((card) => card.rank === rank && (!selectedSuit || suitSatisfiesClient(card.suit, selectedSuit))),
  );

  return (
    <main className="app-shell felt">
      <header className="topbar">
        <div>
          <p>Room {game.roomCode}</p>
          <h1>Kadi</h1>
        </div>
        <button className="icon-button" type="button" onClick={onRestart} aria-label="Back to lobby">
          ↻
        </button>
      </header>

      <ConnectionBanner status={connectionStatus} onRetry={onRetry} />

      <section className="table" aria-label="Kadi table">
        <div className="opponents">
          {opponents.map((player) => (
            <Opponent key={player.id} player={player} active={currentPlayer?.id === player.id} />
          ))}
        </div>

        <div className="center-row">
          <div className="direction-indicator" aria-label={game.direction === 1 ? "Clockwise" : "Counter-clockwise"}>
            <span className="glyph" aria-hidden="true">
              {game.direction === 1 ? "⟳" : "⟲"}
            </span>
            <span>{game.direction === 1 ? "Clockwise" : "Reversed"}</span>
          </div>

          <section className="play-zone" aria-label="Discard and draw piles">
            <div className="pile">
              <span>Draw</span>
              <div className="pile-stack">
                <div className="stack-shadow" aria-hidden="true" />
                <div className="stack-shadow" aria-hidden="true" />
                <Card card={{ rank: "K", suit: "spades" }} hidden />
              </div>
              <b>{game.drawCount} left</b>
            </div>
            <div className="pile discard">
              <span>Discard</span>
              <div className="pile-stack">
                <Card card={top} />
              </div>
              <b>{cardName(top)}</b>
            </div>
          </section>
        </div>

        <section className="status-panel" aria-live="polite">
          <div>
            <span>Turn</span>
            <strong>{currentPlayer?.name ?? "Game over"}</strong>
          </div>
          <div>
            <span>Suit</span>
            <strong className={currentSuit?.color === "red" ? "red-text" : ""}>
              {currentSuit?.icon} {currentSuit?.label ?? currentSuit?.id}
            </strong>
          </div>
          <div>
            <span>Penalty</span>
            <strong>{game.pendingPenalty ? `+${game.pendingPenalty}` : "None"}</strong>
          </div>
          {game.declaredRank && (
            <div>
              <span>Rank lock</span>
              <strong>{game.declaredRank}</strong>
            </div>
          )}
        </section>

        <p className="message">{game.message}</p>

        <section className="controls" aria-label="Game controls">
          <div className="suit-picker" aria-label="Ace suit declaration">
            {SUITS.map((suit) => (
              <button
                key={suit.id}
                type="button"
                className={`${selectedSuit === suit.id ? "selected" : ""} ${suit.color === "red" ? "red-text" : ""}`}
                onClick={() => {
                  setSelectedSuit(suit.id);
                  setSuitText(suit.label);
                }}
                aria-label={`Declare ${suit.label}`}
              >
                {suit.icon}
              </button>
            ))}
            {SUIT_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                className={`group ${selectedSuit === group.id ? "selected" : ""} ${group.color === "red" ? "red-text" : ""}`}
                onClick={() => {
                  setSelectedSuit(group.id);
                  setSuitText(group.label);
                }}
                aria-label={`Declare ${group.label}`}
                title={group.label}
              >
                {group.icon}
              </button>
            ))}
          </div>
          <label className="field suit-text" aria-label="Or type a suit declaration">
            <span>
              Or type it — {selectedSuit ? `declaring ${suitRequirementDisplay(selectedSuit)?.label ?? selectedSuit}` : "no suit declared (defaults to the card's own suit)"}
            </span>
            <input
              value={suitText}
              onChange={(event) => handleSuitTextChange(event.target.value)}
              placeholder="e.g. hearts, red, spades..."
              maxLength={20}
            />
          </label>
          <label className="field suit-dropdown" aria-label="Or pick a suit declaration from a list">
            <span>Or pick from a list</span>
            <select
              value={selectedSuit ?? ""}
              onChange={(event) => {
                const value = event.target.value || null;
                setSelectedSuit(value);
                setSuitText(value ? suitRequirementDisplay(value)?.label ?? value : "");
              }}
            >
              <option value="">No declaration (defaults to the card's suit)</option>
              {[...SUITS, ...SUIT_GROUPS].map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {showRankPicker && (
            <label className="field rank-picker" aria-label="Special Ace: also declare a rank">
              <span>+ Rank ({selectedCards.length >= 2 ? `${selectedCards.length} Aces` : "Ace of Spades"})</span>
              {lockableRanks.length > 0 ? (
                <select value={selectedRank ?? ""} onChange={(event) => setSelectedRank(event.target.value)}>
                  <option value="" disabled>
                    Pick a rank you hold...
                  </option>
                  {lockableRanks.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                    </option>
                  ))}
                </select>
              ) : (
                <em>No card left in hand to back a rank lock — this will only lock the suit.</em>
              )}
            </label>
          )}
          <button
            type="button"
            className={canDeclareKadi ? "kadi-nudge" : ""}
            onClick={onKadi}
            disabled={!canDeclareKadi}
          >
            Niko Kadi
          </button>
          <button type="button" onClick={onDraw} disabled={!yourTurn}>
            {game.pendingPenalty ? `Pick ${game.pendingPenalty}` : "Pick"}
          </button>
          {selection.length > 0 && (
            <button type="button" className="play-confirm" onClick={() => playCards(selection)}>
              Play {selection.length}
            </button>
          )}
        </section>

        <section className="hand-section" aria-label="Your hand">
          <div className="hand-heading">
            <strong>{you?.name ?? "Your"} hand</strong>
            <span>{you?.hand.length ?? 0} cards</span>
          </div>
          {selection.length > 0 && (
            <p className="connection-note">
              {selection.length} card{selection.length > 1 ? "s" : ""} selected — tap another matching card to add it, tap "Play" to confirm, or tap a selected card again to remove it.
            </p>
          )}
          <div className="hand">
            {you?.hand.map((card, index) => {
              const isSelected = selection.includes(card.id);
              const isSelectable = (() => {
                if (isSelected || selection.length === 0) return false;
                const selectedCards = selection.map((id) => you.hand.find((c) => c.id === id)).filter(Boolean);
                return selectedCards.length > 0 && matchesSelectionMode(selectedCards, card);
              })();
              const state = isSelected ? "selected" : isSelectable ? "selectable" : "normal";
              return (
                <Card
                  key={card.id}
                  card={card}
                  disabled={!yourTurn}
                  selected={isSelected}
                  selectable={isSelectable}
                  style={fanCardStyle(index, you.hand.length, state)}
                  onClick={() => toggleCard(card)}
                />
              );
            })}
          </div>
        </section>
      </section>

      <aside className="log-panel" aria-label="Game log">
        <strong>Game log</strong>
        {game.log.map((entry, index) => (
          <p key={`${entry}-${index}`}>{entry}</p>
        ))}
      </aside>

      {game.winner && (
        <section className="winner" role="dialog" aria-modal="true" aria-label="Winner">
          <div>
            <span>Kadi</span>
            <h2>{game.winner} wins</h2>
            <button type="button" onClick={onRestart}>
              Back to lobby
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default function App() {
  const initialRoomCode = useMemo(() => getInitialRoomCode(), []);
  const token = useMemo(() => getPlayerToken(), []);
  const [submitting, setSubmitting] = useState(false);
  const [roomCode, setRoomCode] = useState(() => {
    const session = getSession();
    const resuming = Boolean(session?.roomCode) && (!initialRoomCode || initialRoomCode === session.roomCode);
    return resuming ? session.roomCode : "";
  });
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("connected");
  const [retryTick, setRetryTick] = useState(0);
  const nameRef = useRef(getSession()?.name || "");
  const failCountRef = useRef(0);

  const applySnapshot = useCallback((data) => {
    setRoom(data.room);
    setGame(data.game);
  }, []);

  function retryConnection() {
    failCountRef.current = 0;
    setConnectionStatus("connecting");
    setRetryTick((tick) => tick + 1);
  }

  // Poll for state while we're in a room; any user action also applies its
  // own response immediately for instant feedback between poll ticks.
  useEffect(() => {
    if (!roomCode) return undefined;
    let cancelled = false;
    setConnectionStatus("connecting");

    async function poll() {
      try {
        const data = await callApi("state", { roomCode, name: nameRef.current, token });
        if (cancelled) return;
        applySnapshot(data);
        setError("");
        failCountRef.current = 0;
        setConnectionStatus("connected");
      } catch (err) {
        if (cancelled) return;
        if (err.isNetworkError) {
          failCountRef.current += 1;
          setConnectionStatus(failCountRef.current >= 3 ? "failed" : "reconnecting");
          return;
        }
        setError(err.message);
        if (/not found/i.test(err.message)) {
          clearSession();
          setRoomCode("");
          setRoom(null);
          setGame(null);
        }
      }
    }

    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomCode, token, applySnapshot, retryTick]);

  async function createRoom(name) {
    setError("");
    setSubmitting(true);
    nameRef.current = name;
    try {
      const data = await callApi("create", { name, token });
      window.history.replaceState(null, "", `/room/${data.roomCode}`);
      saveSession(data.roomCode, name);
      applySnapshot(data);
      setRoomCode(data.roomCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function joinRoom(code, name) {
    setError("");
    setSubmitting(true);
    nameRef.current = name;
    try {
      const data = await callApi("join", { roomCode: code, name, token });
      window.history.replaceState(null, "", `/room/${data.roomCode}`);
      saveSession(data.roomCode, name);
      applySnapshot(data);
      setRoomCode(data.roomCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function leaveRoom() {
    clearSession();
    window.location.href = "/";
  }

  async function sendAction(action, payload) {
    try {
      const data = await callApi(action, { roomCode, name: nameRef.current, token, ...payload });
      applySnapshot(data);
    } catch (err) {
      setError(err.message);
    }
  }

  if (game) {
    return (
      <GameScreen
        game={game}
        viewerId={token}
        connectionStatus={connectionStatus}
        onRetry={retryConnection}
        onPlay={(cardIndices, declaredSuit, declaredRank) => sendAction("play", { cardIndices, declaredSuit, declaredRank })}
        onDraw={() => sendAction("draw", {})}
        onKadi={() => sendAction("kadi", {})}
        onRestart={() => sendAction("restart", {})}
      />
    );
  }

  if (room) {
    return (
      <LobbyScreen
        room={room}
        viewerId={token}
        connectionStatus={connectionStatus}
        onRetry={retryConnection}
        onStart={() => sendAction("start", {})}
        onLeave={leaveRoom}
      />
    );
  }

  return (
    <SetupScreen
      submitting={submitting}
      error={error}
      initialRoomCode={initialRoomCode}
      connectionStatus="connected"
      onRetry={() => {}}
      onCreate={createRoom}
      onJoin={joinRoom}
    />
  );
}
