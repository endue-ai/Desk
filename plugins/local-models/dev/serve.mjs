#!/usr/bin/env node
// Local models' preview: the plugin's ui/ in an ordinary browser, outside the desk. It serves the
// page, the theme's tokens and base kit, and dev/sdk.js in place of /_desk/plugin-sdk.js. The shim
// sends net.* here, where real TCP sockets open (only to this computer), and fs.* to a folder of
// its own. Made-up model servers stand in for Ollama (:11434) and llama.cpp (:8080) unless --real.
//
//   node plugins/local-models/dev/serve.mjs [--port 4340] [--real] [--root <folder>] [--token-ms 14]
//
// For people working on the plugin; the desk itself never loads anything from dev/.
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { totalmem } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeCurl } from "./fake-curl.mjs";
import { startFakeEngine } from "./fake-engine.mjs";
import { hubAnswer } from "./fake-hub.mjs";
import { startFakeLlm } from "./fake-llm.mjs";
import { seedFiles, seedModels } from "./seed.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = join(HERE, "../ui");
const KIT = join(HERE, "../../../packages/ui/src");
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const port = Number(arg("port", "4340"));
const real = process.argv.includes("--real");
const ROOT = resolve(arg("root", join(HERE, ".preview-home")));
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

/** Where the page's sockets go: the made-up servers stand in for the usual ports. @type {Map<number, number>} */
const remap = new Map();
if (!real) {
  const fake = await startFakeLlm({ tokenMs: Number(arg("token-ms", "14")) });
  remap.set(11434, fake.ollamaPort);
  remap.set(8080, fake.openaiPort);
}

/** @param {import("node:http").IncomingMessage} req */
const body = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/** Sockets the page opened: their bytes wait here until its stream reads them. */
/** @type {Map<string, { socket: import("node:net").Socket, queue: string[], wake?: () => void, ended?: string }>} */
const sockets = new Map();
let nextSocket = 0;

/** @param {{ host: string, port: number, timeoutMs?: number }} p */
function openSocket(p) {
  return new Promise((done) => {
    if (p.host !== "127.0.0.1" && p.host !== "localhost") {
      done({
        error: {
          code: "permission_denied",
          message: "the preview opens sockets to this computer only",
        },
      });
      return;
    }
    const to = real || enginePorts.has(p.port) ? p.port : remap.get(p.port);
    if (to === undefined) {
      done({ error: { code: "io_error", message: "connection refused" } });
      return;
    }
    const socket = connect({ host: "127.0.0.1", port: to });
    const timer = setTimeout(() => {
      socket.destroy();
      done({ error: { code: "timeout", message: "no answer" } });
    }, p.timeoutMs ?? 10000);
    socket.once("error", (e) => {
      clearTimeout(timer);
      done({ error: { code: "io_error", message: String(e.message) } });
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      const id = `s${++nextSocket}`;
      const entry = {
        socket,
        queue: /** @type {string[]} */ ([]),
        wake: /** @type {(() => void) | undefined} */ (undefined),
        ended: /** @type {string | undefined} */ (undefined),
      };
      socket.on("data", (d) => {
        entry.queue.push(JSON.stringify({ data: d.toString("base64") }));
        entry.wake?.();
      });
      socket.on("close", () => {
        entry.ended = "closed";
        entry.wake?.();
      });
      socket.on("error", () => {});
      sockets.set(id, entry);
      done({ result: { socketId: id } });
    });
  });
}

/** Programs the page started: their output waits here until its stream reads it. */
/** @type {Map<string, { queue: string[], wake?: () => void, ended?: boolean, kill: () => void }>} */
const procs = new Map();
/** Ports the made-up engine listens on, open to the page's sockets. @type {Set<number>} */
const enginePorts = new Set();
let nextProc = 0;

/** Start a program for the page: the made-up llama-server, or sysctl's memory answer. @param {{ command: string, args?: string[] }} p */
async function startProc(p) {
  const id = `p${++nextProc}`;
  const entry = {
    queue: /** @type {string[]} */ ([]),
    wake: /** @type {(() => void) | undefined} */ (undefined),
    ended: false,
    kill: () => {},
  };
  procs.set(id, entry);
  const push = (/** @type {object} */ x) => {
    entry.queue.push(JSON.stringify(x));
    entry.wake?.();
  };
  const out = (/** @type {string} */ stream, /** @type {string} */ text) =>
    push({ stream, data: Buffer.from(`${text}\n`).toString("base64") });
  const exit = (/** @type {number | null} */ code) => {
    push({ exit: code ?? undefined });
    entry.ended = true;
    entry.wake?.();
  };
  const name = p.command.split("/").pop();
  if (name === "llama-server" && !real) {
    const cwd = /** @type {any} */ (p).cwd ? inside(/** @type {any} */ (p).cwd) : ROOT;
    const args = (p.args ?? []).map((a, i, all) =>
      all[i - 1] === "-m" || all[i - 1] === "--mmproj" ? resolve(cwd, a) : a,
    );
    const port = Number(args[args.indexOf("--port") + 1]);
    enginePorts.add(port);
    const engine = await startFakeEngine(args, {
      onLine: out,
      onExit: (code) => {
        enginePorts.delete(port);
        exit(code);
      },
    });
    entry.kill = () => engine.kill();
  } else if (name === "curl" && !real) {
    const cwd = /** @type {any} */ (p).cwd ? inside(/** @type {any} */ (p).cwd) : ROOT;
    const curl = startFakeCurl(p.args ?? [], cwd, { onLine: out, onExit: exit });
    entry.kill = () => curl.kill();
  } else if (name === "sysctl") {
    setTimeout(() => {
      out("stdout", `${totalmem()}\n1`);
      exit(0);
    }, 20);
  } else return { error: { code: "not_found", message: `${p.command} is not in the preview` } };
  return { result: { procId: id } };
}

/** A path the page names (~/x or /x), kept inside ROOT. @param {string} path */
function inside(path) {
  const rel = path.replace(/^~\/?/, "").replace(/^\/+/, "");
  const full = resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(`${ROOT}/`))
    throw Object.assign(new Error("outside"), { code: "permission_denied" });
  return full;
}

/** The fs.* calls the window makes, on files under ROOT. @param {string} method @param {any} p */
async function fsCall(method, p) {
  if (method === "fs.read") {
    const full = inside(p.path);
    const size = (await stat(full)).size;
    let data;
    if (p.offset !== undefined || p.length !== undefined) {
      const start = Math.min(p.offset ?? 0, size);
      const length = Math.max(0, Math.min(p.length ?? size - start, size - start));
      const handle = await open(full, "r");
      try {
        data = Buffer.alloc(length);
        await handle.read(data, 0, length, start);
      } finally {
        await handle.close();
      }
    } else data = await readFile(full);
    return p.encoding === "base64"
      ? { content: data.toString("base64"), encoding: "base64", size }
      : { content: data.toString("utf8"), encoding: "utf8", size };
  }
  if (method === "fs.write") {
    const full = inside(p.path);
    if (p.createDirs) await mkdir(dirname(full), { recursive: true });
    await writeFile(full, p.encoding === "base64" ? Buffer.from(p.content, "base64") : p.content);
    return { bytes: p.content.length };
  }
  if (method === "fs.list") {
    const full = inside(p.path);
    const entries = [];
    for (const name of await readdir(full)) {
      const s = await stat(join(full, name));
      entries.push({
        name,
        kind: s.isDirectory() ? "dir" : "file",
        size: s.size,
        modifiedAt: new Date(s.mtimeMs).toISOString(),
      });
    }
    return { entries };
  }
  if (method === "fs.stat") {
    const s = await stat(inside(p.path));
    return {
      kind: s.isDirectory() ? "dir" : "file",
      size: s.size,
      modifiedAt: new Date(s.mtimeMs).toISOString(),
    };
  }
  if (method === "fs.mkdir") {
    await mkdir(inside(p.path), { recursive: true });
    return { created: [] };
  }
  if (method === "fs.rename") {
    await rename(inside(p.from), inside(p.to));
    return {};
  }
  if (method === "fs.trash") {
    await rm(inside(p.path), { recursive: true, force: true });
    return {};
  }
  throw Object.assign(new Error(`${method} is not in the preview`), { code: "unsupported" });
}

/** A theme of plugins/theme as the custom properties the desk would set on the page. */
async function themeCss(/** @type {string} */ id) {
  const manifest = JSON.parse(await readFile(join(HERE, "../../theme/plugin.json"), "utf8"));
  const theme = (manifest.contributes?.themes ?? []).find(
    (/** @type {{ id: string }} */ t) => t.id === id,
  );
  if (!theme) return "";
  const prop = (/** @type {string} */ name) =>
    `--desk-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/([a-z])(\d)/g, "$1-$2")}`;
  return `:root {\n${Object.entries(theme.tokens ?? {})
    .map(([k, v]) => `  ${prop(k)}: ${v};`)
    .join("\n")}\n}\n`;
}

const codeOf = (/** @type {any} */ e) =>
  e.code === "ENOENT" ? "not_found" : e.code === "EEXIST" ? "exists" : (e.code ?? "io_error");

await mkdir(ROOT, { recursive: true });
if (!real) await seedModels(ROOT);
seedFiles(ROOT);
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (/** @type {unknown} */ value) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.method === "POST" && url.pathname === "/_dev/net/connect")
      return send(await openSocket(await body(req)));
    if (req.method === "POST" && url.pathname === "/_dev/net/send") {
      const p = await body(req);
      const entry = sockets.get(p.socketId);
      if (!entry) return send({ error: { code: "not_found", message: "no such socket" } });
      await new Promise((r) => entry.socket.write(Buffer.from(p.data, "base64"), r));
      return send({ result: {} });
    }
    if (req.method === "POST" && url.pathname === "/_dev/net/close") {
      const p = await body(req);
      sockets.get(p.socketId)?.socket.destroy();
      return send({ result: {} });
    }
    if (url.pathname === "/_dev/net/read") {
      const entry = sockets.get(url.searchParams.get("id") ?? "");
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      if (!entry) return res.end(`${JSON.stringify({ closed: "not_found" })}\n`);
      req.on("close", () => entry.socket.destroy());
      for (;;) {
        while (entry.queue.length) res.write(`${entry.queue.shift()}\n`);
        if (entry.ended) {
          res.end(`${JSON.stringify({ closed: entry.ended })}\n`);
          sockets.delete(url.searchParams.get("id") ?? "");
          return;
        }
        await new Promise((r) => {
          entry.wake = () => {
            entry.wake = undefined;
            r(undefined);
          };
        });
      }
    }
    if (req.method === "POST" && url.pathname === "/_dev/net/fetch") {
      const p = await body(req);
      if (!/^https:\/\/huggingface\.co\//.test(p.url))
        return send({ error: { code: "permission_denied", message: "huggingface.co only" } });
      if (!real) return send({ result: hubAnswer(p.url) });
      const r = await fetch(p.url, { headers: p.headers });
      return send({
        result: {
          status: r.status,
          headers: Object.fromEntries(r.headers),
          body: await r.text(),
          bodyEncoding: "utf8",
        },
      });
    }
    if (req.method === "POST" && url.pathname === "/_dev/proc/spawn")
      return send(await startProc(await body(req)));
    if (req.method === "POST" && url.pathname === "/_dev/proc/kill") {
      const p = await body(req);
      procs.get(p.procId)?.kill();
      return send({ result: {} });
    }
    if (url.pathname === "/_dev/proc/read") {
      const entry = procs.get(url.searchParams.get("id") ?? "");
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      if (!entry) return res.end(`${JSON.stringify({ exit: -1 })}\n`);
      // A page that goes away takes its programs with it, as the desk does when a plugin unloads.
      req.on("close", () => entry.kill());
      for (;;) {
        while (entry.queue.length) res.write(`${entry.queue.shift()}\n`);
        if (entry.ended) return res.end();
        await new Promise((r) => {
          entry.wake = () => {
            entry.wake = undefined;
            r(undefined);
          };
        });
      }
    }
    if (req.method === "POST" && url.pathname === "/_dev/fs") {
      const { method, params } = await body(req);
      try {
        return send({ result: await fsCall(method, params) });
      } catch (error) {
        const e = /** @type {any} */ (error);
        return send({ error: { code: codeOf(e), message: String(e.message) } });
      }
    }
    if (url.pathname === "/_dev/config") return send({ root: ROOT, real });
    if (url.pathname === "/_dev/theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end(await themeCss(url.searchParams.get("id") ?? "desk.theme.light"));
    }
    let file;
    if (url.pathname === "/_desk/plugin-sdk.js") file = join(HERE, "sdk.js");
    else if (url.pathname.startsWith("/_dev/") && /\.(m?js|png|jpg)$/.test(url.pathname))
      file = join(HERE, url.pathname.slice(6));
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
      "content-type":
        TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(
    `Local models preview on http://127.0.0.1:${port}/ (${real ? "real servers" : "made-up servers on :11434 and :8080"}, files in ${ROOT})`,
  );
});
