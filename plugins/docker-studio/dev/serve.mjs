#!/usr/bin/env node
// Docker Studio's preview: the plugin's ui/ in an ordinary browser, outside the desk. It serves the
// page, the theme's tokens and base kit, and dev/sdk.js in place of /_desk/plugin-sdk.js. The shim
// sends proc.spawn here: by default to the seeded engine in dev/fake (no Docker needed, the same
// screen every time), with --real to the docker program on this machine, without a shell.
//
//   node plugins/docker-studio/dev/serve.mjs [--port 4327] [--real]
//
// For people working on the plugin; the desk itself never loads anything from dev/.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { docker } from "./fake/cli.mjs";
import { createWorld, seedEvents } from "./fake/world.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = join(HERE, "../ui");
const KIT = join(HERE, "../../../packages/ui/src");
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const port = Number(arg("port", "4327"));
const real = process.argv.includes("--real");
let world = createWorld();
seedEvents(world);

const TYPES = /** @type {Record<string, string>} */ ({
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
});

/** @param {import("node:http").IncomingMessage} req */
const body = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/** Running processes by the shim's id: write to stdin, kill. */
/** @type {Map<string, { write(data: string, close: boolean): void, kill(): void }>} */
const procs = new Map();

/** Start docker (fake or real) for one /_dev/spawn and stream what it writes as NDJSON. */
function start(/** @type {any} */ job, /** @type {import("node:http").ServerResponse} */ res) {
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  // A process that prints nothing yet (a shell waiting for input) still has started.
  res.flushHeaders();
  let ended = false;
  const send = (/** @type {object} */ frame) => {
    if (!ended) res.write(`${JSON.stringify(frame)}\n`);
  };
  const finish = (
    /** @type {number | null} */ code,
    /** @type {string | null} */ signal = null,
  ) => {
    if (ended) return;
    send({ exit: code, signal });
    ended = true;
    procs.delete(job.procId);
    res.end();
  };
  if (real) {
    const child = spawn("docker", job.args, {
      cwd: job.cwd || process.cwd(),
      env: { ...process.env, ...job.env },
      shell: false,
    });
    child.stdout.on("data", (c) => send({ s: "stdout", d: c.toString("utf8") }));
    child.stderr.on("data", (c) => send({ s: "stderr", d: c.toString("utf8") }));
    child.on("error", (e) => {
      send({ s: "stderr", d: String(e) });
      finish(127);
    });
    child.on("close", (code, signal) => finish(code, signal));
    procs.set(job.procId, {
      write: (data, close) => {
        if (data) child.stdin.write(data);
        if (close) child.stdin.end();
      },
      kill: () => child.kill("SIGTERM"),
    });
    res.on("close", () => {
      if (!ended) child.kill("SIGTERM");
    });
    return;
  }
  /** @type {Array<() => void>} */
  const kills = [];
  /** @type {Array<(data: string, close: boolean) => void>} */
  const inputs = [];
  procs.set(job.procId, {
    write: (data, close) => {
      for (const fn of inputs) fn(data, close);
    },
    kill: () => {
      for (const fn of kills) fn();
      finish(143, "SIGTERM");
    },
  });
  res.on("close", () => {
    if (!ended) for (const fn of kills) fn();
    ended = true;
    procs.delete(job.procId);
  });
  try {
    void docker(world, job.args, {
      out: (text) => send({ s: "stdout", d: text }),
      err: (text) => send({ s: "stderr", d: text }),
      exit: (code) => finish(code),
      onKill: (fn) => kills.push(fn),
      onInput: (fn) => inputs.push(fn),
    });
  } catch (error) {
    send({ s: "stderr", d: String(error) });
    finish(1);
  }
}

/** A theme of plugins/theme as the custom properties the desk would set on the page. */
async function themeCss(/** @type {string} */ id) {
  const manifest = JSON.parse(await readFile(join(HERE, "../../theme/plugin.json"), "utf8"));
  const theme = (manifest.contributes?.themes ?? []).find((/** @type {any} */ t) => t.id === id);
  if (!theme) return "";
  const prop = (/** @type {string} */ name) =>
    `--desk-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/([a-z])(\d)/g, "$1-$2")}`;
  const lines = Object.entries(theme.tokens ?? {}).map(([k, v]) => `  ${prop(k)}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/_dev/spawn") return start(await body(req), res);
    if (
      req.method === "POST" &&
      (url.pathname === "/_dev/write" || url.pathname === "/_dev/kill")
    ) {
      const job = await body(req);
      const proc = procs.get(job.procId);
      if (url.pathname === "/_dev/write") proc?.write(job.data ?? "", job.close === true);
      else proc?.kill();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (req.method === "POST" && url.pathname === "/_dev/reset") {
      world = createWorld();
      seedEvents(world);
      res.writeHead(200);
      return res.end("{}");
    }
    if (url.pathname === "/_dev/theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end(await themeCss(url.searchParams.get("id") ?? "desk.theme.light"));
    }
    let file;
    if (url.pathname === "/_desk/plugin-sdk.js") file = join(HERE, "sdk.js");
    else if (url.pathname === "/_desk/brain-demo.js") file = join(HERE, "brain-demo.js");
    else if (url.pathname === "/_desk/tokens.css") file = join(KIT, "tokens.css");
    else if (url.pathname === "/_desk/base.css") file = join(KIT, "base.css");
    else {
      const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(
        /^(\.\.[/\\])+/,
        "",
      );
      file = join(UI, path);
      if (!file.startsWith(UI)) throw new Error("outside");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(
    `Docker Studio preview on http://127.0.0.1:${port}/ (${real ? "the docker program" : "the seeded engine"})`,
  );
});
