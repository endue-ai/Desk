#!/usr/bin/env node
// Git Studio's preview: the plugin's ui/ in an ordinary browser, outside the desk. It serves the
// page, the theme's tokens and base kit, and dev/sdk.js in place of /_desk/plugin-sdk.js; the shim
// sends proc.spawn here, where the real git runs (only git, without a shell, in the folder given).
//
//   node plugins/git-studio/dev/serve.mjs --repo <folder> [--port 4319]
//
// For people working on the plugin; the desk itself never loads anything from dev/.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = join(HERE, "../ui");
const KIT = join(HERE, "../../../packages/ui/src");
const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const repo = arg("repo", process.cwd());
const port = Number(arg("port", "4319"));
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

/** Run git once: args as an array, stdin when given, the output back in base64. */
function git(
  /** @type {{ args: string[], cwd?: string, env?: Record<string, string>, input?: string }} */ job,
) {
  return new Promise((resolve) => {
    const child = spawn("git", job.args, {
      cwd: job.cwd || repo,
      env: { ...process.env, ...job.env },
      shell: false,
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", (e) =>
      resolve({
        code: 127,
        signal: null,
        stdout: "",
        stderr: Buffer.from(String(e)).toString("base64"),
      }),
    );
    child.on("close", (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(out).toString("base64"),
        stderr: Buffer.concat(err).toString("base64"),
      }),
    );
    if (job.input !== undefined) child.stdin.end(job.input);
    else child.stdin.end();
  });
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

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/_dev/git") {
      const job = await body(req);
      if (!Array.isArray(job.args)) throw new Error("args");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await git(job)));
      return;
    }
    if (url.pathname === "/_dev/config") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ repo }));
      return;
    }
    if (url.pathname === "/_dev/theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(await themeCss(url.searchParams.get("id") ?? "desk.theme.light"));
      return;
    }
    let file;
    if (url.pathname === "/_desk/plugin-sdk.js") file = join(HERE, "sdk.js");
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
  console.log(`Git Studio preview on http://127.0.0.1:${port}/ for ${repo}`);
});
