import { existsSync } from "node:fs";
import { db } from "./database.js";
import { getRecap } from "./recap.js";

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const latestSession = db
    .prepare("SELECT session_id FROM events ORDER BY id DESC LIMIT 1")
    .get() as { session_id: string } | undefined;

  if (!latestSession) {
    throw new Error("No recorded session was found. Run the app or replay a sample first.");
  }

  console.log(await getRecap(latestSession.session_id));
}

main().catch((error: unknown) => {
  console.error("Could not print the latest recap:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
