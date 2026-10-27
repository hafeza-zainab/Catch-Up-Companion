import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

type EventSubscription = {
  type: string;
  version: string;
  condition: Record<string, string>;
};

type EventSubMessage = {
  metadata: { message_type: string; subscription_type?: string; message_timestamp: string };
  payload: {
    session?: { id: string; reconnect_url: string | null };
    event?: unknown;
  };
};

const sessionId = randomUUID();
const db = new Database("catchup.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    "user" TEXT,
    text TEXT NOT NULL,
    ts TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    "user" TEXT,
    ts TEXT NOT NULL
  );
`);
const insertMessage = db.prepare(
  'INSERT INTO messages (session_id, "user", text, ts) VALUES (?, ?, ?, ?)',
);
const insertEvent = db.prepare(
  'INSERT INTO events (session_id, type, "user", ts) VALUES (?, ?, ?, ?)',
);

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const clientId = requiredEnv("TWITCH_CLIENT_ID");
const token = requiredEnv("TWITCH_TOKEN");
const channelId = requiredEnv("CHANNEL_ID");
const botId = requiredEnv("BOT_ID");

const subscriptions: EventSubscription[] = [
  {
    type: "channel.chat.message",
    version: "1",
    condition: { broadcaster_user_id: channelId, user_id: botId },
  },
  {
    type: "channel.follow",
    version: "2",
    condition: { broadcaster_user_id: channelId, moderator_user_id: botId },
  },
  {
    type: "channel.subscribe",
    version: "1",
    condition: { broadcaster_user_id: channelId },
  },
  {
    type: "channel.raid",
    version: "1",
    condition: { to_broadcaster_user_id: channelId },
  },
];

async function subscribe(sessionId: string): Promise<void> {
  for (const subscription of subscriptions) {
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...subscription,
        transport: { method: "websocket", session_id: sessionId },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to subscribe to ${subscription.type}: ${response.status} ${await response.text()}`);
    }
    console.log(`Subscribed to ${subscription.type}`);
  }
}

function connect(url = "wss://eventsub.wss.twitch.tv/ws"): void {
  const socket = new WebSocket(url);
  let handoff = false;

  socket.addEventListener("message", ({ data }) => {
    void (async () => {
      const message = JSON.parse(String(data)) as EventSubMessage;
      const { message_type: messageType, subscription_type: subscriptionType } = message.metadata;

      if (messageType === "session_welcome") {
        const sessionId = message.payload.session?.id;
        if (!sessionId) throw new Error("Twitch welcome message did not include a session ID");
        await subscribe(sessionId);
      } else if (messageType === "notification") {
        const event = message.payload.event as Record<string, unknown>;
        const eventType = subscriptionType ?? "unknown";
        const timestamp = message.metadata.message_timestamp;
        const user = String(
          event.chatter_user_name ??
            event.user_name ??
            event.from_broadcaster_user_name ??
            "",
        );

        insertEvent.run(sessionId, eventType, user || null, timestamp);
        if (eventType === "channel.chat.message") {
          const chatMessage = event.message as { text?: string } | undefined;
          insertMessage.run(sessionId, user || null, chatMessage?.text ?? "", timestamp);
        }
        console.log(eventType, JSON.stringify(event));
      } else if (messageType === "session_reconnect") {
        const reconnectUrl = message.payload.session?.reconnect_url;
        if (!reconnectUrl) throw new Error("Twitch reconnect message did not include a URL");
        handoff = true;
        connect(reconnectUrl);
      } else if (messageType === "revocation") {
        console.error("Subscription revoked:", JSON.stringify(message.payload));
      }
    })().catch((error: unknown) => {
      console.error("EventSub message handling failed:", error);
      socket.close();
    });
  });

  socket.addEventListener("close", () => {
    if (handoff) return;
    console.error("EventSub connection closed; reconnecting in 5 seconds.");
    setTimeout(() => connect(), 5_000);
  });
  socket.addEventListener("error", (event) => console.error("EventSub WebSocket error:", event));
}

connect();
