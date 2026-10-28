import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { anonymizeRecapData, getRecapFromDatabase } from "./recap.js";

test("recap summarizes chatters, repeats, spikes, raids, and subs for one session", () => {
  const messages = [
    { user: "Alice", text: "Hello chat", ts: "2025-01-01T12:00:00.000Z" },
    { user: "Alice", text: "Hello chat", ts: "2025-01-01T12:00:10.000Z" },
    { user: "Alice", text: "Hello chat", ts: "2025-01-01T12:00:20.000Z" },
    { user: "Bob", text: "PogChamp", ts: "2025-01-01T12:00:30.000Z" },
    { user: "Bob", text: "Nice", ts: "2025-01-01T12:00:40.000Z" },
    { user: "Cara", text: "Wow", ts: "2025-01-01T12:00:50.000Z" },
    { user: "Drew", text: "Earlier", ts: "2025-01-01T11:56:00.000Z" },
  ];
  const database = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("GROUP BY \"user\"")) {
            return [
              { user: "Alice", count: 3 },
              { user: "Bob", count: 2 },
              { user: "Cara", count: 1 },
            ];
          }
          if (sql.includes("FROM messages")) return messages;
          return [
            { type: "channel.raid", count: 1 },
            { type: "channel.subscribe", count: 1 },
          ];
        },
      };
    },
  };

  const recap = getRecapFromDatabase("fake-session", database);
  assert.match(recap, /Top chatters: Alice \(3\), Bob \(2\), Cara \(1\)/);
  assert.match(recap, /"Hello chat" ×3/);
  assert.match(recap, /Chat-rate spike: 6 messages\/min/);
  assert.match(recap, /Raids: 1; subs: 1/);
  assert.equal(recap.split("\n").length, 4);
});

test("Gemini recap data uses chatter aliases and restores names in the final text", () => {
  const anonymized = anonymizeRecapData({
    topChatters: [
      { user: "Alice", count: 12 },
      { user: "Bob", count: 8 },
    ],
    repeatedPhrases: [{ phrase: "Alice and Bob did it again", count: 3 }],
    chatRateSpike: "none",
    raids: 0,
    subs: 0,
    chatterNames: ["Alice", "Bob", "Cara"],
  });

  assert.deepEqual(anonymized.data.topChatters, [
    { user: "chatter 1", count: 12 },
    { user: "chatter 2", count: 8 },
  ]);
  assert.deepEqual(anonymized.data.repeatedPhrases, [
    { phrase: "chatter 1 and chatter 2 did it again", count: 3 },
  ]);
  assert.equal(JSON.stringify(anonymized.data).includes("Alice"), false);
  assert.equal(JSON.stringify(anonymized.data).includes("Cara"), false);
  assert.equal(
    anonymized.restoreNames("Chatter 1 and chatter 2 were there."),
    "Alice and Bob were there.",
  );
});

test("messages starting with ! do not count toward top chatters or repeated phrases", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        "user" TEXT,
        text TEXT NOT NULL,
        ts TEXT NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        "user" TEXT,
        ts TEXT NOT NULL
      );
    `);

    const insertMessage = database.prepare(
      'INSERT INTO messages (session_id, "user", text, ts) VALUES (?, ?, ?, ?)',
    );
    for (let index = 0; index < 4; index++) {
      insertMessage.run("session", "CommandUser", "!catchup", `2025-01-01T12:00:0${index}.000Z`);
    }
    for (let index = 0; index < 3; index++) {
      insertMessage.run("session", "RegularUser", "great play", `2025-01-01T12:01:0${index}.000Z`);
    }

    const recap = getRecapFromDatabase("session", database);
    assert.match(recap, /Top chatters: RegularUser \(3\)/);
    assert.doesNotMatch(recap, /CommandUser/);
    assert.match(recap, /"great play" ×3/);
    assert.doesNotMatch(recap, /"!catchup"/);
  } finally {
    database.close();
  }
});
