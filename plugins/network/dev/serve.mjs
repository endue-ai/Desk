#!/usr/bin/env node
// The Network plugin's preview: its ui/ in an ordinary browser, outside the desk. It serves the
// page, its catalogs and OUI asset, the theme's tokens and base kit, and dev/sdk.js in place of
// /_desk/plugin-sdk.js: a made-up home network answers arp, ping, route, ifconfig, dig and
// system_profiler, and net.connect, so the screen is the same every time and nothing is probed.
//
//   node plugins/network/dev/serve.mjs [--port 4351]
//   http://localhost:4351/ui/index.html?lang=ko&scheme=light&admin=yes&tab=checkup&check=all&brain=demo
//
// For people working on the plugin; the desk itself never loads anything from dev/.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KIT = fileURLToPath(new URL("../../../packages/ui/src/", import.meta.url));
const at = process.argv.indexOf("--port");
const port = Number(at > 0 ? process.argv[at + 1] : 4351);
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
};

/** @param {string} url */
function fileFor(url) {
  if (url === "/_desk/plugin-sdk.js") return join(ROOT, "dev/sdk.js");
  if (url === "/_desk/tokens.css") return join(KIT, "tokens.css");
  if (url === "/_desk/base.css") return join(KIT, "base.css");
  if (url === "/_desk/ui.js") return null;
  const path = normalize(join(ROOT, url));
  return path.startsWith(ROOT) ? path : undefined;
}

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = fileFor(url);
  if (file === null) {
    res.writeHead(200, { "content-type": "text/javascript" }).end("export {};\n");
    return;
  }
  try {
    if (!file) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type":
        TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}/ui/index.html`));
