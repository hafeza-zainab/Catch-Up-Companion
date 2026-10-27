import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { handleEventNotification } from "./eventHandler.js";

type RecordedNotification = {
  metadata: {
    message_type: string;
    subscription_type?: string;
    message_timestamp: string;
  };
  payload: { event?: unknown };
};

const [fileArgument, speedArgument] = process.argv.slice(2);
const filePath = fileArgument ?? "samples/chat-events.json";
const speed = speedArgument === undefined ? 1 : Number(speedArgument);

if (!Number.isFinite(speed) || speed <= 0) {
  throw new Error("Speed must be a number greater than 0 (for example: 5 for 5x speed).");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Replay file must contain a JSON array of EventSub notifications.");

  const notifications = parsed as RecordedNotification[];
  const sessionId = randomUUID();
  console.log(`Replaying ${notifications.length} events from ${filePath} at ${speed}x; session ${sessionId}`);

  let previousTimestamp: number | undefined;
  for (const notification of notifications) {
    const { metadata, payload } = notification;
    if (
      metadata?.message_type !== "notification" ||
      !metadata.subscription_type ||
      !metadata.message_timestamp ||
      !isRecord(payload?.event)
    ) {
      throw new Error("Replay file entries must be EventSub notification messages with an event payload.");
    }

    const timestamp = Date.parse(metadata.message_timestamp);
    if (Number.isNaN(timestamp)) throw new Error(`Invalid event timestamp: ${metadata.message_timestamp}`);
    if (previousTimestamp !== undefined) {
      const delay = Math.max(0, (timestamp - previousTimestamp) / speed);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    previousTimestamp = timestamp;

    await handleEventNotification(
      sessionId,
      metadata.subscription_type,
      payload.event,
      metadata.message_timestamp,
    );
  }

  console.log(`Replay complete; session ${sessionId}`);
}

main().catch((error: unknown) => {
  console.error("Replay failed:", error);
  process.exitCode = 1;
});
