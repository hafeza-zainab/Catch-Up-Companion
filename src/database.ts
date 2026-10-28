import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("catchup.db");

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
