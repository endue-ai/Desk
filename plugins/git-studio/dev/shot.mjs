#!/usr/bin/env node
// Screenshots of the preview for reviews: drives a headless Chromium shell over the DevTools
// protocol (no window opens, no test runner), one page per shot, steps run in the page between.
//
//   node plugins/git-studio/dev/shot.mjs <plan.json> <out-dir>
//
// plan.json: { "base": "http://127.0.0.1:4319/", "width": 1600, "height": 960, "scale": 2,
//   "shots": [{ "name": "graph", "query": "scheme=dark", "steps": ["js…"], "wait": "js boolean" }] }
// The browser is $GS_CHROME, else Playwright's cached chrome-headless-shell.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const [planPath, outDir] = process.argv.slice(2);
if (!planPath || !outDir) {
  console.error("usage: shot.mjs <plan.json> <out-dir>");
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, "utf8"));
mkdirSync(outDir, { recursive: true });

function chrome() {
  if (process.env.GS_CHROME) return process.env.GS_CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const dir of existsSync(cache) ? readdirSync(cache) : []) {
    if (!dir.startsWith("chromium_headless_shell")) continue;
    for (const sub of readdirSync(join(cache, dir))) {
      const bin = join(cache, dir, sub, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("No headless Chromium: set GS_CHROME");
}

const profile = mkdtempSync(join(process.env.GS_TMP ?? tmpdir(), "gs-shot-"));
const browser = spawn(
  chrome(),
  [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--hide-scrollbars",
    "--font-render-hinting=none",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const endpoint = await new Promise((resolve, reject) => {
  let text = "";
  browser.stderr.on("data", (chunk) => {
    text += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (match) resolve(match[1]);
  });
  browser.on("exit", () => reject(new Error(`browser exited: ${text}`)));
});

const ws = new WebSocket(endpoint);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let id = 0;
/** @type {Map<number, { resolve(v: any): void, reject(e: Error): void }>} */
const waiting = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const entry = message.id !== undefined ? waiting.get(message.id) : undefined;
  if (!entry) return;
  waiting.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
/** @param {string} method @param {object} [params] @param {string} [sessionId] */
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} session @param {string} expression */
async function evaluate(session, expression) {
  const result = await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    session,
  );
  if (result.exceptionDetails)
    throw new Error(
      `${expression}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
    );
  return result.result?.value;
}
/** Wait until the page is mounted, no git runs, and `extra` holds. */
async function settle(/** @type {string} */ session, extra = "true") {
  const ready = `document.body?.dataset.ready === "1" && !document.querySelector(".sb-busy") && (${extra})`;
  for (let i = 0; i < 100; i++) {
    if (await evaluate(session, ready).catch(() => false)) {
      await sleep(250);
      if (await evaluate(session, ready).catch(() => false)) return;
    }
    await sleep(100);
  }
  console.warn("timed out waiting for", extra);
}

try {
  for (const shot of plan.shots) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: shot.width ?? plan.width ?? 1600,
        height: shot.height ?? plan.height ?? 960,
        deviceScaleFactor: plan.scale ?? 2,
        mobile: false,
      },
      sessionId,
    );
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", { url: `${plan.base}?${shot.query ?? ""}` }, sessionId);
    await settle(sessionId);
    for (const step of shot.steps ?? []) {
      await evaluate(sessionId, `(async () => { ${step} })()`);
      await sleep(150);
      await settle(sessionId);
    }
    if (shot.wait) await settle(sessionId, shot.wait);
    const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = join(outDir, `${shot.name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(file);
    await send("Target.closeTarget", { targetId });
  }
} finally {
  ws.close();
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill();
  await Promise.race([exited, sleep(3000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
