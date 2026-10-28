import { DatabaseSync } from "node:sqlite";

const REPEAT_THRESHOLD = 3;
const CHAT_SPIKE_MIN_MESSAGES = 5;

type MessageRow = { user: string | null; text: string; ts: string };
type EventCounts = { type: string; count: number };
type RecapData = {
  topChatters: Array<{ user: string; count: number }>;
  repeatedPhrases: Array<{ phrase: string; count: number }>;
  chatRateSpike: string;
  raids: number;
  subs: number;
  chatterNames?: string[];
};
type RecapDatabase = {
  prepare(sql: string): { all(...params: any[]): any[] };
};
type AnonymizedRecap = { data: RecapData; restoreNames(text: string): string };

export async function getRecap(sessionId: string): Promise<string> {
  const database = new DatabaseSync("catchup.db");
  try {
    const data = collectRecapData(sessionId, database);
    const template = formatRecap(data);
    const apiKey = process.env.GEMINI_API_KEY;
    return apiKey ? await polishRecap(data, apiKey, template) : template;
  } finally {
    database.close();
  }
}

export function getRecapFromDatabase(sessionId: string, database: RecapDatabase): string {
  return formatRecap(collectRecapData(sessionId, database));
}

export function anonymizeRecapData(data: RecapData): AnonymizedRecap {
  const names = new Map<string, string>();
  for (const user of [...data.topChatters.map(({ user }) => user), ...(data.chatterNames ?? [])]) {
    const key = user.toLocaleLowerCase();
    if (!names.has(key)) names.set(key, `chatter ${names.size + 1}`);
  }

  const replacements = [...names].map(([name, alias]) => ({
    name,
    alias,
    displayName: data.topChatters.find(({ user }) => user.toLocaleLowerCase() === name)?.user ?? name,
  }));
  const anonymizeText = (text: string): string =>
    replacements
      .slice()
      .sort((a, b) => b.displayName.length - a.displayName.length)
      .reduce(
        (result, { displayName, alias }) =>
          result.replace(new RegExp(escapeRegExp(displayName), "gi"), alias),
        text,
      );

  return {
    data: {
      topChatters: data.topChatters.map(({ user, ...chatter }) => ({
        ...chatter,
        user: names.get(user.toLocaleLowerCase()) ?? user,
      })),
      repeatedPhrases: data.repeatedPhrases.map(({ phrase, ...repeat }) => ({
        ...repeat,
        phrase: anonymizeText(phrase),
      })),
      chatRateSpike: data.chatRateSpike,
      raids: data.raids,
      subs: data.subs,
    },
    restoreNames(text: string): string {
      return replacements.reduce(
        (result, { alias, displayName }) =>
          result.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), displayName),
        text,
      );
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRecapData(sessionId: string, database: RecapDatabase): RecapData {
  const topChatters = database
    .prepare(
      `SELECT "user" AS user, COUNT(*) AS count
       FROM messages
       WHERE session_id = ? AND "user" IS NOT NULL AND "user" != ''
         AND substr(text, 1, 1) != '!'
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
    if (text.startsWith("!")) continue;
    const phrase = text.trim().replace(/\s+/g, " ");
    if (phrase) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }
  const repeated = [...phraseCounts]
    .filter(([, count]) => count >= REPEAT_THRESHOLD)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([phrase, count]) => ({ phrase, count }));

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
      const localTime = new Date(peakMinute * 60_000).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      spike = `${peakCount} messages/min at ${localTime}`;
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

  return {
    topChatters,
    repeatedPhrases: repeated,
    chatRateSpike: spike,
    raids: counts.get("channel.raid") ?? 0,
    subs: counts.get("channel.subscribe") ?? 0,
    chatterNames: [...new Set(messages.map(({ user }) => user).filter((user): user is string => Boolean(user)))],
  };
}

function formatRecap(data: RecapData): string {
  const chatterLine = data.topChatters.length
    ? `Top chatters: ${data.topChatters.map(({ user, count }) => `${user} (${count})`).join(", ")}`
    : "Top chatters: none";
  const repeatLine = data.repeatedPhrases.length
    ? `Repeated phrases/emotes (≥${REPEAT_THRESHOLD}): ${data.repeatedPhrases
        .map(({ phrase, count }) => `${JSON.stringify(phrase)} ×${count}`)
        .join(", ")}`
    : `Repeated phrases/emotes (≥${REPEAT_THRESHOLD}): none`;

  return [
    chatterLine,
    repeatLine,
    `Chat-rate spike: ${data.chatRateSpike}`,
    `Raids: ${data.raids}; subs: ${data.subs}`,
  ].join("\n");
}

async function polishRecap(data: RecapData, apiKey: string, fallback: string): Promise<string> {
  const anonymized = anonymizeRecapData(data);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Write a friendly Twitch stream recap using only these facts: ${JSON.stringify(anonymized.data)}. Use the supplied chatter labels as written. Return exactly 3 short lines of plain text, with no bullets or numbering. Do not invent details. Keep the entire response under 450 characters.`,
                },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 120, temperature: 0.4 },
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);

    const result = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = result.candidates?.[0]?.content?.parts?.map(({ text: part }) => part ?? "").join("").trim();
    if (!text || text.length > 500) return fallback;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.length === 3 ? anonymized.restoreNames(lines.join("\n")) : fallback;
  } catch {
    return fallback;
  }
}
