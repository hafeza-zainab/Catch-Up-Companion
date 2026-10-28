import { db } from "./database.js";

const insertMessage = db.prepare(
  'INSERT INTO messages (session_id, "user", text, ts) VALUES (?, ?, ?, ?)',
);
const insertEvent = db.prepare(
  'INSERT INTO events (session_id, type, "user", ts) VALUES (?, ?, ?, ?)',
);

type EventRecord = Record<string, unknown>;
type CatchupHandler = (userId: string, parentMessageId: string) => Promise<void>;
type FirstChatMessageHandler = (userId: string, isCatchupCommand: boolean) => Promise<void>;

export async function handleEventNotification(
  sessionId: string,
  eventType: string,
  event: EventRecord,
  timestamp: string,
  onCatchup?: CatchupHandler,
  onFirstChatMessage?: FirstChatMessageHandler,
): Promise<void> {
  const user = String(
    event.chatter_user_name ?? event.user_name ?? event.from_broadcaster_user_name ?? "",
  );

  insertEvent.run(sessionId, eventType, user || null, timestamp);
  if (eventType === "channel.chat.message") {
    const chatMessage = event.message as { text?: string } | undefined;
    const text = chatMessage?.text ?? "";
    insertMessage.run(sessionId, user || null, text, timestamp);
    if (event.chatter_user_id && onFirstChatMessage) {
      await onFirstChatMessage(String(event.chatter_user_id), text.trim() === "!catchup");
    }
    if (text.trim() === "!catchup" && event.chatter_user_id && event.message_id && onCatchup) {
      await onCatchup(String(event.chatter_user_id), String(event.message_id));
    }
  }

  console.log(eventType, JSON.stringify(event));
}
