import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { getRecap } from "./recap.js";

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
const insertMessage = db.prepare(
  'INSERT INTO messages (session_id, "user", text, ts) VALUES (?, ?, ?, ?)',
);
const insertEvent = db.prepare(
  'INSERT INTO events (session_id, type, "user", ts) VALUES (?, ?, ?, ?)',
);
const catchupCooldowns = new Map<string, number>();
const CATCHUP_COOLDOWN_MS = 60_000;

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

async function replyWithRecap(userId: string, parentMessageId: string): Promise<void> {
  const now = Date.now();
  for (const [id, expiresAt] of catchupCooldowns) {
    if (expiresAt <= now) catchupCooldowns.delete(id);
  }
  if ((catchupCooldowns.get(userId) ?? 0) > now) return;

  catchupCooldowns.set(userId, now + CATCHUP_COOLDOWN_MS);
  try {
    const response = await fetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_id: channelId,
        sender_id: botId,
        message: (await getRecap(sessionId)).slice(0, 500),
        reply_parent_message_id: parentMessageId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Twitch chat API returned ${response.status}: ${await response.text()}`);
    }
    const result = (await response.json()) as {
      data?: Array<{ is_sent: boolean; drop_reason?: { message?: string } | null }>;
    };
    if (result.data?.[0]?.is_sent === false) {
      throw new Error(`Twitch did not send the recap: ${result.data[0].drop_reason?.message ?? "unknown reason"}`);
    }
  } catch (error) {
    catchupCooldowns.delete(userId);
    console.error("Failed to reply with recap:", error);
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
          const text = chatMessage?.text ?? "";
          insertMessage.run(sessionId, user || null, text, timestamp);
          if (text.trim() === "!catchup" && event.chatter_user_id && event.message_id) {
            await replyWithRecap(String(event.chatter_user_id), String(event.message_id));
          }
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
