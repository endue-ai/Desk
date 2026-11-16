#!/usr/bin/env node
// API Studio's preview: the plugin's ui/ in an ordinary browser, outside the desk. It serves the
// page, the theme's tokens and base kit, and dev/sdk.js in place of /_desk/plugin-sdk.js; the shim
// sends proc.spawn here, where the real curl runs (only curl, without a shell), and fs.* to a
// folder of its own. A made-up shop API answers on the next port, for requests to try.
//
//   node plugins/api-studio/dev/serve.mjs [--port 4338] [--root <folder for collections>]
//
// For people working on the plugin; the desk itself never loads anything from dev/.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startDemoApi } from "./demo-api.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = join(HERE, "../ui");
const KIT = join(HERE, "../../../packages/ui/src");
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const port = Number(arg("port", "4338"));
const demoPort = port + 1;
const ROOT = resolve(arg("root", join(HERE, ".preview-home")));
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** @param {import("node:http").IncomingMessage} req */
const body = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/** Run curl once: args as an array, stdin when given, the output back in base64. */
function curl(/** @type {{ command: string, args: string[], input?: string }} */ job) {
  return new Promise((done) => {
    if (job.command !== "curl") {
      done({
        code: 127,
        signal: null,
        stdout: "",
        stderr: Buffer.from("only curl runs here").toString("base64"),
      });
      return;
    }
    const child = spawn("curl", job.args, { shell: false });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", (e) =>
      done({
        code: 127,
        signal: null,
        stdout: "",
        stderr: Buffer.from(String(e)).toString("base64"),
      }),
    );
    child.on("close", (code, signal) =>
      done({
        code,
        signal,
        stdout: Buffer.concat(out).toString("base64"),
        stderr: Buffer.concat(err).toString("base64"),
      }),
    );
    child.stdin.end(job.input ?? "");
  });
}

/** A path the page names (~/x or /x), kept inside ROOT. @param {string} path */
function inside(path) {
  const rel = path.replace(/^~\/?/, "").replace(/^\/+/, "");
  const full = resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(`${ROOT}/`))
    throw Object.assign(new Error("outside"), { code: "permission_denied" });
  return full;
}

/** The fs.* calls the studio makes, on files under ROOT. @param {string} method @param {any} p */
async function fsCall(method, p) {
  if (method === "fs.read") {
    const data = await readFile(inside(p.path));
    return p.encoding === "base64"
      ? { content: data.toString("base64"), encoding: "base64", size: data.length }
      : { content: data.toString("utf8"), encoding: "utf8", size: data.length };
  }
  if (method === "fs.write") {
    const full = inside(p.path);
    if (p.createDirs) await mkdir(dirname(full), { recursive: true });
    await writeFile(full, p.encoding === "base64" ? Buffer.from(p.content, "base64") : p.content);
    return {};
  }
  if (method === "fs.list") {
    const full = inside(p.path);
    const names = await readdir(full);
    const entries = [];
    for (const name of names) {
      const s = await stat(join(full, name));
      entries.push({
        name,
        kind: s.isDirectory() ? "dir" : "file",
        size: s.size,
        modified: s.mtimeMs,
      });
    }
    return { entries };
  }
  if (method === "fs.stat") {
    const s = await stat(inside(p.path));
    return { kind: s.isDirectory() ? "dir" : "file", size: s.size, modified: s.mtimeMs };
  }
  if (method === "fs.mkdir") {
    await mkdir(inside(p.path), { recursive: p.parents === true });
    return {};
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
  const themes = manifest.contributes?.themes ?? [];
  const theme = themes.find((/** @type {{ id: string }} */ t) => t.id === id);
  if (!theme) return "";
  const prop = (/** @type {string} */ name) =>
    `--desk-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/([a-z])(\d)/g, "$1-$2")}`;
  const lines = Object.entries(theme.tokens ?? {}).map(([k, v]) => `  ${prop(k)}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

await mkdir(ROOT, { recursive: true });
await startDemoApi(demoPort);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/_dev/spawn") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await curl(await body(req))));
      return;
    }
    if (req.method === "POST" && url.pathname === "/_dev/fs") {
      const { method, params } = await body(req);
      try {
        const result = await fsCall(method, params);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result }));
      } catch (error) {
        const e = /** @type {any} */ (error);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code:
                e.code === "ENOENT"
                  ? "not_found"
                  : e.code === "EEXIST"
                    ? "exists"
                    : (e.code ?? "io"),
              message: String(e.message),
            },
          }),
        );
      }
      return;
    }
    if (url.pathname === "/_dev/config") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ demo: `http://127.0.0.1:${demoPort}`, root: ROOT, home: homedir() }),
      );
      return;
    }
    if (url.pathname === "/_dev/theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(await themeCss(url.searchParams.get("id") ?? "desk.theme.light"));
      return;
    }
    let file;
    if (url.pathname === "/_desk/plugin-sdk.js") file = join(HERE, "sdk.js");
    else if (url.pathname.startsWith("/_dev/") && url.pathname.endsWith(".js"))
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
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(
    `API Studio preview on http://127.0.0.1:${port}/ (demo API on http://127.0.0.1:${demoPort}, files in ${ROOT})`,
  );
});
