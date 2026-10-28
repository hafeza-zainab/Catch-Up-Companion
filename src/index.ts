import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { handleEventNotification } from "./eventHandler.js";
import { getRecap } from "./recap.js";
import { publishRecap, startWebServer } from "./web.js";

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

type SeedEvent = { subscriptionType: string; event: Record<string, unknown>; timestamp: number };

const sessionId = randomUUID();
const catchupCooldowns = new Map<string, number>();
const autoRecapSeenUsers = new Set<string>();
const CATCHUP_COOLDOWN_MS = 60_000;
const AUTO_RECAP_COOLDOWN_MS = 5 * 60_000;
const autoRecapEnabled = process.env.AUTO_RECAP?.toLowerCase() === "true";
let lastAutoRecapAt = 0;

const clientId = process.env.TWITCH_CLIENT_ID?.trim() ?? "";
const token = process.env.TWITCH_TOKEN?.trim() ?? "";
const channelId = process.env.CHANNEL_ID?.trim() ?? "";
const botId = process.env.BOT_ID?.trim() ?? "";
const REQUIRED_SCOPES = [
  "user:read:chat",
  "moderator:read:followers",
  "channel:read:subscriptions",
  "user:write:chat",
];

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
    const recap = await getRecap(sessionId);
    publishRecap(recap);
    const chatMessage = recap.split(/\r?\n/).join(" | ").slice(0, 450);
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
        message: chatMessage,
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

async function showAutoRecap(userId: string, isCatchupCommand: boolean): Promise<void> {
  if (!autoRecapEnabled || userId === botId || autoRecapSeenUsers.has(userId)) return;
  autoRecapSeenUsers.add(userId);
  if (isCatchupCommand) return;

  const now = Date.now();
  if (now - lastAutoRecapAt < AUTO_RECAP_COOLDOWN_MS) return;

  lastAutoRecapAt = now;
  try {
    publishRecap(await getRecap(sessionId));
  } catch (error) {
    lastAutoRecapAt = 0;
    console.error("Failed to show automatic recap:", error);
  }
}

async function validateStartupConfiguration(): Promise<void> {
  const requiredVariables = ["TWITCH_CLIENT_ID", "TWITCH_TOKEN", "CHANNEL_ID", "BOT_ID"];
  const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missingVariables.length) {
    throw new Error(`Missing required environment variable(s): ${missingVariables.join(", ")}. Set them in .env.`);
  }

  let response: Response;
  try {
    response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch (error) {
    throw new Error(`Could not reach Twitch to validate TWITCH_TOKEN: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`TWITCH_TOKEN is invalid or expired (Twitch returned HTTP ${response.status}). Generate a new user access token.`);
  }

  const validation = (await response.json()) as {
    client_id?: string;
    user_id?: string;
    scopes?: string[];
  };
  if (validation.client_id !== clientId) {
    throw new Error("TWITCH_TOKEN belongs to a different Twitch app. Use a token generated with TWITCH_CLIENT_ID.");
  }
  if (validation.user_id !== botId) {
    throw new Error("BOT_ID must match the Twitch user ID that authorized TWITCH_TOKEN.");
  }

  const grantedScopes = new Set(validation.scopes ?? []);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length) {
    throw new Error(`TWITCH_TOKEN is missing required scope(s): ${missingScopes.join(", ")}. Generate a new token with all required scopes.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function seedDemoEvents(filePath: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("SEED_DEMO_FILE must point to a non-empty JSON array of EventSub notifications.");
  }

  const notifications: SeedEvent[] = parsed.map((value, index) => {
    if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.payload)) {
      throw new Error(`SEED_DEMO_FILE entry ${index + 1} is not a valid EventSub notification.`);
    }
    const { metadata, payload } = value;
    if (
      metadata.message_type !== "notification" ||
      typeof metadata.subscription_type !== "string" ||
      typeof metadata.message_timestamp !== "string" ||
      !isRecord(payload.event)
    ) {
      throw new Error(`SEED_DEMO_FILE entry ${index + 1} is not a valid EventSub notification.`);
    }

    const timestamp = Date.parse(metadata.message_timestamp);
    if (Number.isNaN(timestamp)) {
      throw new Error(`SEED_DEMO_FILE entry ${index + 1} has an invalid timestamp.`);
    }
    return { subscriptionType: metadata.subscription_type, event: payload.event, timestamp };
  });

  const timestampOffset = Date.now() - notifications[notifications.length - 1].timestamp;
  for (const notification of notifications) {
    const shiftedTimestamp = new Date(notification.timestamp + timestampOffset).toISOString();
    await handleEventNotification(sessionId, notification.subscriptionType, notification.event, shiftedTimestamp);
  }
  console.log(`Seeded ${notifications.length} demo events from ${filePath} into live session ${sessionId}.`);
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
        await handleEventNotification(
          sessionId,
          eventType,
          event,
          message.metadata.message_timestamp,
          replyWithRecap,
          showAutoRecap,
        );
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

async function start(): Promise<void> {
  try {
    await validateStartupConfiguration();
    const seedFile = process.env.SEED_DEMO_FILE?.trim();
    if (seedFile) await seedDemoEvents(seedFile);
  } catch (error) {
    console.error(`Startup check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log("Twitch token and required scopes validated.");
  startWebServer();
  connect();
}

void start();
