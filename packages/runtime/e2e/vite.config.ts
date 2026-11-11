import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { deskWmWasm } from "../../../scripts/desk-wm-wasm.mjs";
import { largePng } from "./perf/large-png.mjs";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repo = here("../../../");

// What the core serves over desk-plugin:// in the app, the fixture serves over plain HTTP.
const plugins: Record<string, string> = {
  "example.hello-ui": join(repo, "examples/plugin-hello-ui"),
  "test.counter": here("./fixture/plugins/test-counter"),
  "test.echo": here("./fixture/plugins/test-echo"),
  "test.worker": here("./fixture/plugins/test-worker"),
  // Fails to start every time (safe-mode.html, ADR 0061).
  "test.throws": here("./fixture/plugins/test-throws"),
  // Stops answering the desk on command (shell.html?hang=1, #39).
  "test.hang": here("./fixture/plugins/test-hang"),
  "test.theme": here("./themes/test-theme"),
  // Another provider of role:dock on the edges page (ADR 0104) is the counter under another id.
  "test.dock": here("./fixture/plugins/test-counter"),
  // The autoload opener of the desk page is the echo plugin under another id.
  "test.lazy": here("./fixture/plugins/test-echo"),
  // The shell page's terminal (?apps=1) is the counter under the terminal's id.
  "endue.terminal": here("./fixture/plugins/test-counter"),
  "desk.palette": join(repo, "plugins/palette"),
  "desk.views": join(repo, "plugins/views"),
  "desk.universal": join(repo, "plugins/universal"),
  "endue.eris": join(repo, "plugins/eris"),
  "endue.onboarding": join(repo, "plugins/onboarding"),
  "endue.sidebar": join(repo, "plugins/sidebar"),
  "endue.toolbar": join(repo, "plugins/toolbar"),
  "endue.notes": join(repo, "plugins/notes"),
  "endue.images": join(repo, "plugins/images"),
  "endue.explorer": join(repo, "plugins/explorer"),
  "endue.dock": join(repo, "plugins/dock"),
  "endue.agents": join(repo, "plugins/agents"),
  "endue.memory": join(repo, "plugins/memory"),
  "endue.database": join(repo, "plugins/database"),
  "endue.mail": join(repo, "plugins/mail"),
  "endue.projects": join(repo, "plugins/projects"),
};
/** The shell page's ?many=<n> windows (#37): the hello-ui page under test.many-1, test.many-2 … */
/** Each fixture plugin's manifest `imports` by its plugin label: whose files its surfaces may load. */
let importsByLabel: Map<string, string[]> | undefined;
function importsOf(label: string): string[] {
  importsByLabel ??= new Map(
    Object.entries(plugins).map(([id, dir]) => [pluginLabel(id), manifestImports(dir)]),
  );
  return importsByLabel.get(label) ?? [];
}

function manifestImports(dir: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
    return Array.isArray(manifest.imports) ? manifest.imports : [];
  } catch {
    return [];
  }
}

const many = (id: string) =>
  /^test\.many-\d+$/.test(id) ? join(repo, "examples/plugin-hello-ui") : undefined;
const sdk = join(repo, "packages/plugin-sdk/src/index.ts");
const ui = join(repo, "packages/ui/src/bundle.ts");
/** What the app serves under /_desk/ (the SDK, elements and shared sheets), from their sources. */
const desk: Record<string, string> = {
  "/_desk/plugin-sdk.js": sdk,
  "/_desk/ui.js": ui,
  "/_desk/tokens.css": join(repo, "packages/ui/src/tokens.css"),
  "/_desk/base.css": join(repo, "packages/ui/src/base.css"),
};
/**
 * The app's plugin-frame CSP with this server's origins in place of the plugin scheme: the shared host
 * and every surface's, as `desk-plugin:` covers them all in the app.
 */
const csp = readFileSync(join(repo, "crates/desk-web/src/plugin-csp.txt"), "utf8").trim();
export const pluginCsp = (port: string) =>
  csp.replaceAll(
    "{sources}",
    `http://127.0.0.1:${port} http://localhost:${port} http://*.localhost:${port}`,
  );

/**
 * What a request's Host names, as the app's scheme reads it (#36): the shared host (127.0.0.1 or
 * localhost, where the fixture pages are), or one surface of a plugin, `<surface>.<plugin
 * label>.localhost`, with its plugin label. Undefined for any other host.
 */
function hostOf(header = ""): { label?: string; port: string } | undefined {
  const [name = "", port = ""] = header.split(":");
  if (name === "127.0.0.1" || name === "localhost") return { port };
  const label = /^[a-z][a-z0-9-]*\.([a-z][a-z0-9-]*)\.localhost$/.exec(name)?.[1];
  return label === undefined ? undefined : { label, port };
}
/**
 * A plugin id as one host label, as `pluginLabel` in src/plugin-origins.ts makes it. A copy, not an
 * import, so the config loads without the runtime's sources; frames.spec.ts fails if the two differ.
 */
const pluginLabel = (id: string) => id.replaceAll("-", "--").replaceAll(".", "-");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".desk-theme": "application/json",
};

/**
 * Serve plugin files, the SDK and @endue-ai/ui as the core does over desk-plugin:// (the dev page uses
 * it too), plugin pages under the app's CSP.
 */
export function pluginFiles(): Plugin {
  let largeImage: Buffer | undefined;
  return {
    name: "desk-plugin-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://fixture");
        // Sandboxed frames have an opaque origin; module scripts need CORS.
        res.setHeader("Access-Control-Allow-Origin", "*");
        const source = desk[url.pathname];
        // The large image of the frame-time checks (perf/heavy-open.spec.ts, #38), as fs.url serves it.
        if (url.pathname === "/perf/large.png") {
          largeImage ??= largePng();
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Content-Length", String(largeImage.length));
          res.setHeader("Cache-Control", "no-store");
          res.end(largeImage);
          return;
        }
        // The fixture theme market (?market=1 on the shell page names it https://market.test/).
        const market = /^\/market\/(.+)$/.exec(url.pathname)?.[1];
        const match = /^\/plugins\/([^/]+)\/(.+)$/.exec(url.pathname);
        if (!source && !match && market === undefined) return next();
        // As the app's scheme does: a host that names no surface is refused, and so is another
        // plugin's path on a surface's host.
        const host = hostOf(req.headers.host);
        const asked = match?.[1] ?? "";
        const other =
          match &&
          host?.label !== undefined &&
          host.label !== pluginLabel(asked) &&
          !importsOf(host.label).includes(asked);
        if (!host || other) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (source?.endsWith(".css")) {
          res.setHeader("Content-Type", "text/css");
          res.setHeader("Cache-Control", "no-store");
          res.end(readFileSync(source));
          return;
        }
        if (source) {
          res.statusCode = 302;
          res.setHeader("Location", `/@fs${source.split(sep).join("/")}`);
          res.end();
          return;
        }
        const [, id = "", path = market ?? ""] = match ?? [];
        const base = market === undefined ? (plugins[id] ?? many(id)) : here("./themes/market");
        const file = base ? normalize(join(base, path)) : "";
        if (!base || !file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        if (extname(file) === ".html") {
          res.setHeader("Content-Security-Policy", pluginCsp(host.port));
        }
        res.end(readFileSync(file));
      });
    },
  };
}

/**
 * The window manager the fixture pages and the dev page run (#83), served at /desk-wm.wasm: desk-wm
 * as WebAssembly, built when it is stale as the server starts, since these pages have no compositor.
 */
export function deskWm(): Plugin {
  return {
    name: "desk-wm-wasm",
    configureServer(server) {
      const wasm = deskWmWasm();
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? "/", "http://fixture").pathname !== "/desk-wm.wasm") return next();
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(wasm));
      });
    },
  };
}

export default defineConfig({
  root: here("./fixture"),
  plugins: [pluginFiles(), deskWm()],
  server: {
    host: "127.0.0.1",
    // Set by the Playwright configs (e2e/port.ts); 4173 when the fixture is served by hand.
    port: Number(process.env.DESK_E2E_PORT ?? 4173),
    strictPort: true,
    cors: { origin: "*" },
    fs: { allow: [repo] },
  },
  // Only the fixture pages: test plugins import the SDK through their import map, not node_modules.
  optimizeDeps: { entries: ["*.html"] },
  logLevel: "warn",
});
