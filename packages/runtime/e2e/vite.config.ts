import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repo = here("../../../");

// What the core serves over desk-plugin:// in the app, the fixture serves over plain HTTP.
const plugins: Record<string, string> = {
  "example.hello-ui": join(repo, "examples/plugin-hello-ui"),
  "test.counter": here("./fixture/plugins/test-counter"),
  "test.echo": here("./fixture/plugins/test-echo"),
  "test.worker": here("./fixture/plugins/test-worker"),
  // The autoload opener of the desk page is the echo plugin under another id.
  "test.lazy": here("./fixture/plugins/test-echo"),
  "desk.palette": join(repo, "plugins/palette"),
  "desk.views": join(repo, "plugins/views"),
  "endue.eris": join(repo, "plugins/eris"),
  "endue.onboarding": join(repo, "plugins/onboarding"),
  "endue.sidebar": join(repo, "plugins/sidebar"),
  "endue.toolbar": join(repo, "plugins/toolbar"),
  "endue.notes": join(repo, "plugins/notes"),
  "endue.dock": join(repo, "plugins/dock"),
};
const sdk = join(repo, "packages/plugin-sdk/src/index.ts");
const ui = join(repo, "packages/ui/src/bundle.ts");
/** What the app serves under /_desk/ (the SDK, elements and shared sheets), from their sources. */
const desk: Record<string, string> = {
  "/_desk/plugin-sdk.js": sdk,
  "/_desk/ui.js": ui,
  "/_desk/tokens.css": join(repo, "packages/ui/src/tokens.css"),
  "/_desk/base.css": join(repo, "packages/ui/src/base.css"),
};
/** The app's plugin-frame CSP with this server's origin in place of the plugin scheme. */
const csp = readFileSync(join(repo, "apps/desk/src-tauri/src/plugin-csp.txt"), "utf8").trim();
export const pluginCsp = (origin: string) => csp.replaceAll("{sources}", origin);
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

/**
 * Serve plugin files, the SDK and @endue-ai/ui as the core does over desk-plugin:// (the dev page uses
 * it too), plugin pages under the app's CSP.
 */
export function pluginFiles(): Plugin {
  return {
    name: "desk-plugin-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://fixture");
        // Sandboxed frames have an opaque origin; module scripts need CORS.
        res.setHeader("Access-Control-Allow-Origin", "*");
        const source = desk[url.pathname];
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
        const match = /^\/plugins\/([^/]+)\/(.+)$/.exec(url.pathname);
        if (!match) return next();
        const [, id = "", path = ""] = match;
        const base = plugins[id];
        const file = base ? normalize(join(base, path)) : "";
        if (!base || !file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        if (extname(file) === ".html") {
          res.setHeader("Content-Security-Policy", pluginCsp(`http://${req.headers.host}`));
        }
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  root: here("./fixture"),
  plugins: [pluginFiles()],
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
