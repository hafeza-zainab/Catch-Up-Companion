import express from "express";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

const clients = new Set<ServerResponse>();
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));

export function startWebServer(): void {
  const app = express();

  app.use(express.static(publicDirectory));
  app.get("/events", (_request, response) => {
    response.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.flushHeaders();
    response.write("retry: 1000\n\n");
    clients.add(response);

    const keepalive = setInterval(() => response.write(": keepalive\n\n"), 20_000);
    response.on("close", () => {
      clearInterval(keepalive);
      clients.delete(response);
    });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "127.0.0.1", () => {
    console.log(`OBS recap page: http://127.0.0.1:${port}`);
  });
}

export function publishRecap(text: string): void {
  const message = `event: recap\ndata: ${JSON.stringify({ text, durationMs: 15_000 })}\n\n`;
  for (const client of clients) {
    if (!client.writableEnded) client.write(message);
  }
}
