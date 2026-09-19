import { Redis } from "@upstash/redis";

// Raw string mode: we own JSON (de)serialization ourselves so the
// compare-and-swap script below can compare exact byte-for-byte state.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  automaticDeserialization: false,
});

export const ROOM_TTL_SECONDS = 6 * 60 * 60;

function roomKey(code) {
  return `kadi:room:${code}`;
}

const CAS_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
  return 1
else
  return 0
end
`;

export async function createRoomRecord(code, room) {
  const ok = await redis.set(roomKey(code), JSON.stringify(room), {
    nx: true,
    ex: ROOM_TTL_SECONDS,
  });
  return Boolean(ok);
}

// Reads the room, lets `mutate` change it in place, and writes it back only
// if nobody else wrote in between (retrying on conflict). `mutate` may
// return { error } to abort without writing.
export async function updateRoom(code, mutate) {
  const key = roomKey(code);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const before = await redis.get(key);
    if (before === null) return { error: "Room not found." };

    const room = JSON.parse(before);
    const outcome = mutate(room);
    if (outcome && outcome.error) return { error: outcome.error };

    // Deliberately NOT deleting the room just because every player is
    // momentarily stale (e.g. everyone's tab got background-suspended at
    // once, which happens easily when testing via two tabs on one phone).
    // A returning player must still be able to rejoin the same room code —
    // deleting it here meant their very next poll got "Room not found" and
    // the client wiped their session entirely. The room's own TTL already
    // handles real cleanup of truly abandoned rooms.
    const after = JSON.stringify(room);
    if (after === before) return { room };

    const ok = await redis.eval(CAS_SCRIPT, [key], [before, after, String(ROOM_TTL_SECONDS)]);
    if (ok) return { room };
  }

  return { error: "Room is busy, try again." };
}
