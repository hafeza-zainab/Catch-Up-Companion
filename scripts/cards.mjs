import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "demo", "cards");
const isWindows = process.platform === "win32";
const npmCommand = process.env.npm_execpath ? process.execPath : isWindows ? "npm.cmd" : "npm";
const npmPrefixArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];
const accent = "#a78bfa";
const repoUrl = "https://github.com/hafeza-zainab/Catch-Up-Companion";

const cards = [
  {
    path: "/title",
    file: "01-title.png",
    content: `<p class="eyebrow">A Twitch stream companion</p><h1>Catch-Up Companion:<br><span>help new viewers catch up</span></h1>`,
  },
  {
    path: "/problem",
    file: "02-problem.png",
    content: `<p class="eyebrow">The problem</p><h1>New viewers join mid-stream and <span>feel lost.</span></h1>`,
  },
  {
    path: "/how-it-works",
    file: "03-how-it-works.png",
    content: `<p class="eyebrow">How it works</p><h1 class="section-title">A quick recap, right in the stream.</h1><ul><li>A viewer types <code>!catchup</code>.</li><li>The app summarizes chat and channel moments.</li><li>The bot replies in chat; OBS shows the recap card.</li><li>Gemini can polish the text; a local template is the fallback.</li></ul>`,
  },
  {
    path: "/closing",
    file: "04-closing.png",
    content: `<p class="eyebrow">Catch-Up Companion</p><h1>Help every viewer join the conversation.</h1><a href="${repoUrl}">${repoUrl}</a><p class="built">Built with Codex</p>`,
  },
];

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const command = `npm ${args.join(" ")}`;
    const child = spawn(npmCommand, [...npmPrefixArgs, ...args], {
      cwd: root,
      shell: !process.env.npm_execpath && isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after 90 seconds running ${command}`));
    }, 90_000);

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
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
  return new Promise((resolve) => server.close(resolve));
}

function html(content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Catch-Up Companion</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --accent: ${accent}; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #111318; color: #f7f6fb; }
    body { overflow: hidden; }
    main { position: relative; display: flex; align-items: center; width: 100%; height: 100%; padding: 110px 150px; }
    main::before { position: absolute; inset: 0 auto 0 0; width: 12px; background: var(--accent); content: ""; }
    main::after { position: absolute; right: 150px; bottom: 84px; left: 150px; height: 2px; background: linear-gradient(90deg, var(--accent), transparent); content: ""; opacity: .7; }
    section { position: relative; z-index: 1; width: min(1500px, 100%); }
    .eyebrow { margin: 0 0 34px; color: var(--accent); font-size: 23px; font-weight: 750; letter-spacing: .16em; text-transform: uppercase; }
    h1 { max-width: 1450px; margin: 0; font-size: 86px; font-weight: 740; letter-spacing: -.045em; line-height: 1.12; }
    h1 span { color: var(--accent); }
    .section-title { margin-bottom: 30px; font-size: 66px; }
    ul { display: grid; gap: 20px; margin: 0; padding: 0; list-style: none; }
    li { display: flex; align-items: baseline; gap: 20px; color: #e8e7ef; font-size: 39px; line-height: 1.25; }
    li::before { width: 11px; height: 11px; flex: 0 0 11px; border-radius: 50%; background: var(--accent); content: ""; }
    code { color: var(--accent); font-family: inherit; font-weight: 700; }
    a { display: inline-block; margin-top: 38px; color: #d7ccff; font-size: 30px; text-decoration-color: var(--accent); text-underline-offset: 7px; }
    .built { margin: 45px 0 0; color: var(--accent); font-size: 26px; font-weight: 700; letter-spacing: .04em; }
  </style>
</head>
<body><main><section>${content}</section></main></body>
</html>`;
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const server = createServer((request, response) => {
    const card = cards.find(({ path: route }) => route === request.url);
    if (!card) {
      response.writeHead(404).end("Card not found");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html(card.content));
  });

  const port = await listen(server);
  try {
    console.log("Preparing Playwright Chromium (free, Chromium only)...");
    await runNpm(["exec", "--yes", "--package=playwright", "--", "playwright", "install", "chromium"]);
    for (const card of cards) {
      await runNpm([
        "exec",
        "--yes",
        "--package=playwright",
        "--",
        "playwright",
        "screenshot",
        "--browser=chromium",
        "--viewport-size=1920,1080",
        "--wait-for-timeout=150",
        `http://127.0.0.1:${port}${card.path}`,
        path.join(outputDirectory, card.file),
      ]);
      console.log(`Saved ${path.relative(root, path.join(outputDirectory, card.file))}`);
    }
  } finally {
    await close(server);
  }
}

main().catch((error) => {
  console.error(`Card generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
