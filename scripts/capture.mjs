import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const framesDirectory = path.join(root, "demo", "frames");
const sampleFile = path.join(root, "samples", "chat-events.json");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";

function runNpm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const command = `npm ${args.join(" ")}`;
    const child = spawn(npmCommand, args, {
      cwd: root,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const stdout = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after 90 seconds running ${command}`));
    }, 90_000);

    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.pipe(process.stderr);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        reject(new Error(`${command} failed${signal ? ` (signal ${signal})` : ` (exit code ${code})`}`));
      }
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function waitForApp(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`The app exited during startup (exit code ${child.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The app may still be validating its Twitch token and seeding the sample.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the app. Check its Twitch settings in .env.");
}

async function main() {
  await mkdir(framesDirectory, { recursive: true });

  const portServer = createServer();
  const appPort = await listen(portServer);
  await close(portServer);

  const app = spawn(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "src/index.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(appPort),
        SEED_DEMO_FILE: path.relative(root, sampleFile),
        AUTO_RECAP: "false",
      },
      stdio: "inherit",
    },
  );
  let captureServer;

  try {
    const appUrl = `http://127.0.0.1:${appPort}`;
    await waitForApp(appUrl, app);

    const recap = await runNpm(["run", "recap"], {
      env: { ...process.env, GEMINI_API_KEY: "" },
    });
    if (!recap) throw new Error("The seeded session did not produce a recap.");

    captureServer = createServer(async (request, response) => {
      if (request.url === "/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        response.write("retry: 1000\n\n");
        response.write(`event: recap\ndata: ${JSON.stringify({ text: recap, durationMs: 15_000 })}\n\n`);
        return;
      }

      try {
        const upstream = await fetch(`${appUrl}${request.url}`);
        const headers = new Headers(upstream.headers);
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        if (request.url === "/" && (headers.get("content-type") ?? "").includes("text/html")) {
          const html = (await upstream.text()).replace(
            "</head>",
            "<style>html, body { background: #26282d !important; }</style></head>",
          );
          response.writeHead(upstream.status, Object.fromEntries(headers));
          response.end(html);
        } else {
          response.writeHead(upstream.status, Object.fromEntries(headers));
          response.end(Buffer.from(await upstream.arrayBuffer()));
        }
      } catch (error) {
        response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      }
    });

    const capturePort = await listen(captureServer);
    const captureUrl = `http://127.0.0.1:${capturePort}`;
    const screenshot = async (filename, waitMs) =>
      await runNpm([
        "exec",
        "--yes",
        "--package=playwright",
        "--",
        "playwright",
        "screenshot",
        "--browser=chromium",
        "--viewport-size=1920,1080",
        `--wait-for-timeout=${waitMs}`,
        captureUrl,
        path.join(framesDirectory, filename),
      ]);

    console.log("Preparing Playwright Chromium (free, Chromium only)...");
    await runNpm(["exec", "--yes", "--package=playwright", "--", "playwright", "install", "chromium"]);
    await screenshot("overlay-1.png", 1_000);
    await screenshot("overlay-2.png", 15_650);
    console.log(`Saved screenshots to ${path.relative(root, framesDirectory)}.`);
  } finally {
    if (captureServer?.listening) await close(captureServer);
    app.kill();
  }
}

main().catch((error) => {
  console.error(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
