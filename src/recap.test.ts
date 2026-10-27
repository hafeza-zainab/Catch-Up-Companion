import assert from "node:assert/strict";
import { test } from "node:test";
import { getRecapFromDatabase } from "./recap.js";

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
