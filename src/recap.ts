import { createRequire } from "node:module";

const REPEAT_THRESHOLD = 3;
const CHAT_SPIKE_MIN_MESSAGES = 5;

type MessageRow = { user: string | null; text: string; ts: string };
type EventCounts = { type: string; count: number };
type RecapDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
};
const require = createRequire(import.meta.url);

export function getRecap(sessionId: string): string {
  const Sqlite = require("better-sqlite3") as new (filename: string) => RecapDatabase & { close(): void };
  const database = new Sqlite("catchup.db");
  try {
    return getRecapFromDatabase(sessionId, database);
  } finally {
    database.close();
  }
}

export function getRecapFromDatabase(sessionId: string, database: RecapDatabase): string {
  const topChatters = database
    .prepare(
      `SELECT "user" AS user, COUNT(*) AS count
       FROM messages
       WHERE session_id = ? AND "user" IS NOT NULL AND "user" != ''
       GROUP BY "user"
       ORDER BY count DESC, user COLLATE NOCASE
       LIMIT 3`,
    )
    .all(sessionId) as Array<{ user: string; count: number }>;

  const messages = database
    .prepare('SELECT "user" AS user, text, ts FROM messages WHERE session_id = ? ORDER BY ts')
    .all(sessionId) as MessageRow[];

  const phraseCounts = new Map<string, number>();
  for (const { text } of messages) {
    const phrase = text.trim().replace(/\s+/g, " ");
    if (phrase) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }
  const repeated = [...phraseCounts]
    .filter(([, count]) => count >= REPEAT_THRESHOLD)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);

  const minuteCounts = new Map<number, number>();
  for (const { ts } of messages) {
    const timestamp = Date.parse(ts);
    if (!Number.isNaN(timestamp)) {
      const minute = Math.floor(timestamp / 60_000);
      minuteCounts.set(minute, (minuteCounts.get(minute) ?? 0) + 1);
    }
  }
  let spike = "none";
  if (minuteCounts.size) {
    const firstMinute = Math.min(...minuteCounts.keys());
    const lastMinute = Math.max(...minuteCounts.keys());
    const elapsedMinutes = lastMinute - firstMinute + 1;
    const average = messages.length / elapsedMinutes;
    const [peakMinute, peakCount] = [...minuteCounts].sort((a, b) => b[1] - a[1])[0];
    if (peakCount >= CHAT_SPIKE_MIN_MESSAGES && peakCount >= average * 2) {
      spike = `${peakCount} messages/min at ${new Date(peakMinute * 60_000).toISOString()}`;
    }
  }

  const eventCounts = database
    .prepare(
      `SELECT type, COUNT(*) AS count
       FROM events
       WHERE session_id = ? AND type IN ('channel.raid', 'channel.subscribe')
       GROUP BY type`,
    )
    .all(sessionId) as EventCounts[];
  const counts = new Map(eventCounts.map(({ type, count }) => [type, count]));

  const chatterLine = topChatters.length
    ? `Top chatters: ${topChatters.map(({ user, count }) => `${user} (${count})`).join(", ")}`
    : "Top chatters: none";
  const repeatLine = repeated.length
    ? `Repeated phrases/emotes (≥${REPEAT_THRESHOLD}): ${repeated
        .map(([phrase, count]) => `${JSON.stringify(phrase)} ×${count}`)
        .join(", ")}`
    : `Repeated phrases/emotes (≥${REPEAT_THRESHOLD}): none`;

  return [
    chatterLine,
    repeatLine,
    `Chat-rate spike: ${spike}`,
    `Raids: ${counts.get("channel.raid") ?? 0}; subs: ${counts.get("channel.subscribe") ?? 0}`,
  ].join("\n");
}
