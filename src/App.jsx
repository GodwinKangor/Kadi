import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SUITS = [
  { id: "hearts", label: "Hearts", icon: "♥", color: "red" },
  { id: "diamonds", label: "Diamonds", icon: "♦", color: "red" },
  { id: "clubs", label: "Clubs", icon: "♣", color: "black" },
  { id: "spades", label: "Spades", icon: "♠", color: "black" },
];

const QUESTIONS = new Set(["8", "Q"]);
const ANSWERS = new Set(["A", "4", "5", "6", "7", "9", "10"]);
const PENALTY_DRAW = { 2: 2, 3: 3, JOK: 5 };

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

function Card({ card, hidden = false, disabled = false, onClick }) {
  const suit = cardSuit(card);
  const className = ["card", suit?.color === "red" ? "red" : "black", hidden ? "hidden" : "", disabled ? "disabled" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} type="button" disabled={disabled || hidden} onClick={onClick}>
      {hidden ? (
        <span className="card-back">K</span>
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

function Opponent({ player, active }) {
  return (
    <section className={`opponent ${active ? "active" : ""}`} aria-label={`${player.name} status`}>
      <div>
        <strong>{player.name}</strong>
        <span>{player.saidKadi ? "Niko Kadi" : "Waiting"}</span>
      </div>
      <div className="mini-hand" aria-label={`${player.hand.length} cards`}>
        {player.hand.slice(0, 8).map((card) => (
          <Card key={card.id} card={card} hidden />
        ))}
      </div>
      <b>{player.hand.length}</b>
    </section>
  );
}

function SetupScreen({ connected, error, initialRoomCode, onCreate, onJoin }) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const hasInvite = Boolean(initialRoomCode);

  return (
    <main className="setup-shell">
      <section className="setup-panel" aria-label="Room setup">
        <div className="setup-heading">
          <p>Kadi</p>
          <h1>{hasInvite ? "Join the room" : "Create or join"}</h1>
        </div>

        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={18} placeholder="e.g. Godwin" />
        </label>

        <div className="room-actions">
          {!hasInvite && (
            <button className="start-button" type="button" disabled={!connected} onClick={() => onCreate(name)}>
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

          <button className="start-button secondary" type="button" disabled={!connected || !roomCode.trim()} onClick={() => onJoin(roomCode, name)}>
            Join room
          </button>
        </div>

        <p className="connection-note">{connected ? "Connected to room server." : "Connecting to room server..."}</p>
        {error && <p className="error-note">{error}</p>}
      </section>
    </main>
  );
}

function LobbyScreen({ room, viewerId, onStart, onLeave }) {
  const isHost = room.hostId === viewerId;
  const shareLink = `${window.location.origin}/room/${room.roomCode}`;
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard?.writeText(shareLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="setup-shell">
      <section className="setup-panel lobby-panel" aria-label="Room lobby">
        <div className="setup-heading">
          <p>Room {room.roomCode}</p>
          <h1>Waiting room</h1>
        </div>

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
              <span>{player.id === room.hostId ? "Host" : "Joined"}</span>
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

function GameScreen({ game, viewerId, onPlay, onDraw, onKadi, onRestart }) {
  const you = game.players.find((player) => player.id === viewerId);
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const currentPlayer = game.players[game.currentPlayer];
  const currentSuit = SUITS.find((suit) => suit.id === activeSuit(game));
  const yourTurn = currentPlayer?.id === viewerId && !game.winner;
  const [selectedSuit, setSelectedSuit] = useState("hearts");
  const top = topCard(game);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p>Room {game.roomCode}</p>
          <h1>Kadi</h1>
        </div>
        <button className="icon-button" type="button" onClick={onRestart} aria-label="Back to lobby">
          ↻
        </button>
      </header>

      <section className="table" aria-label="Kadi table">
        <div className="opponents">
          {opponents.map((player) => (
            <Opponent key={player.id} player={player} active={currentPlayer?.id === player.id} />
          ))}
        </div>

        <section className="play-zone" aria-label="Discard and draw piles">
          <div className="pile">
            <span>Draw</span>
            <Card card={{ rank: "K", suit: "spades" }} hidden />
            <b>{game.drawCount}</b>
          </div>
          <div className="pile discard">
            <span>Discard</span>
            <Card card={top} />
            <b>{cardName(top)}</b>
          </div>
        </section>

        <section className="status-panel" aria-live="polite">
          <div>
            <span>Turn</span>
            <strong>{currentPlayer?.name ?? "Game over"}</strong>
          </div>
          <div>
            <span>Suit</span>
            <strong className={currentSuit?.color === "red" ? "red-text" : ""}>
              {currentSuit?.icon} {currentSuit?.label}
            </strong>
          </div>
          <div>
            <span>Penalty</span>
            <strong>{game.pendingPenalty ? `+${game.pendingPenalty}` : "None"}</strong>
          </div>
        </section>

        <p className="message">{game.message}</p>

        <section className="controls" aria-label="Game controls">
          <div className="suit-picker" aria-label="Ace suit declaration">
            {SUITS.map((suit) => (
              <button
                key={suit.id}
                type="button"
                className={`${selectedSuit === suit.id ? "selected" : ""} ${suit.color === "red" ? "red-text" : ""}`}
                onClick={() => setSelectedSuit(suit.id)}
                aria-label={`Declare ${suit.label}`}
              >
                {suit.icon}
              </button>
            ))}
          </div>
          <button type="button" onClick={onKadi} disabled={!yourTurn || !you || you.hand.length > 2 || you.saidKadi}>
            Niko Kadi
          </button>
          <button type="button" onClick={onDraw} disabled={!yourTurn}>
            {game.pendingPenalty ? `Pick ${game.pendingPenalty}` : "Pick"}
          </button>
        </section>

        <section className="hand-section" aria-label="Your hand">
          <div className="hand-heading">
            <strong>{you?.name ?? "Your"} hand</strong>
            <span>{you?.hand.length ?? 0} cards</span>
          </div>
          <div className="hand">
            {you?.hand.map((card, index) => (
              <Card key={card.id} card={card} disabled={!yourTurn} onClick={() => onPlay(index, selectedSuit)} />
            ))}
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
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [viewerId, setViewerId] = useState("");
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setViewerId(socket.id);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:update", (nextRoom) => {
      setRoom(nextRoom);
      if (nextRoom.status === "lobby") setGame(null);
    });
    socket.on("game:update", (nextGame) => {
      setGame(nextGame);
      setRoom((current) => current ? { ...current, status: "playing" } : current);
    });

    return () => socket.disconnect();
  }, []);

  function createRoom(name) {
    setError("");
    socketRef.current?.emit("room:create", { name }, (reply) => {
      if (!reply?.ok) {
        setError(reply?.error || "Could not create room.");
        return;
      }
      window.history.replaceState(null, "", `/room/${reply.roomCode}`);
    });
  }

  function joinRoom(roomCode, name) {
    setError("");
    socketRef.current?.emit("room:join", { roomCode, name }, (reply) => {
      if (!reply?.ok) {
        setError(reply?.error || "Could not join room.");
        return;
      }
      window.history.replaceState(null, "", `/room/${reply.roomCode}`);
    });
  }

  function leaveRoom() {
    window.location.href = "/";
  }

  if (game) {
    return (
      <GameScreen
        game={game}
        viewerId={viewerId}
        onPlay={(cardIndex, declaredSuit) => socketRef.current?.emit("game:play", { roomCode: game.roomCode, cardIndex, declaredSuit })}
        onDraw={() => socketRef.current?.emit("game:draw", { roomCode: game.roomCode })}
        onKadi={() => socketRef.current?.emit("game:kadi", { roomCode: game.roomCode })}
        onRestart={() => socketRef.current?.emit("game:restart", { roomCode: game.roomCode })}
      />
    );
  }

  if (room) {
    return (
      <LobbyScreen
        room={room}
        viewerId={viewerId}
        onStart={() => socketRef.current?.emit("room:start", { roomCode: room.roomCode })}
        onLeave={leaveRoom}
      />
    );
  }

  return (
    <SetupScreen
      connected={connected}
      error={error}
      initialRoomCode={initialRoomCode}
      onCreate={createRoom}
      onJoin={joinRoom}
    />
  );
}
