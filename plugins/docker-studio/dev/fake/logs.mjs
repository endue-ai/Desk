// What the preview's containers write: believable log lines per kind of image (nginx access
// lines, a Node service with levels, Postgres, Redis, a migration that fails, a health check that
// keeps failing), at times spread over the last hours, and new ones while a log is followed.

import { seeded } from "./world.mjs";

const PATHS = [
  "/",
  "/api/products",
  "/api/cart",
  "/api/products/42",
  "/static/app.js",
  "/healthz",
  "/api/orders",
  "/favicon.ico",
];
const AGENTS = ["Mozilla/5.0 (Macintosh)", "curl/8.7.1", "Prometheus/2.55.0"];

/** One line a container of this kind writes at time `t`: [stream, text]. */
export function lineOf(
  /** @type {any} */ c,
  /** @type {() => number} */ rnd,
  /** @type {number} */ t,
  /** @type {number} */ n,
) {
  const pick = (/** @type {any[]} */ list) => list[Math.floor(rnd() * list.length)];
  const d = new Date(t);
  const stamp = d.toISOString();
  switch (c.kind === "node" ? c.service || "api" : c.kind) {
    case "nginx": {
      const status = rnd() < 0.92 ? 200 : pick([304, 404, 502]);
      return [
        "stdout",
        `172.20.0.1 - - [${d.toUTCString().slice(5, 25)} +0000] "GET ${pick(PATHS)} HTTP/1.1" ${status} ${Math.floor(rnd() * 9000) + 120} "-" "${pick(AGENTS)}"`,
      ];
    }
    case "api":
    case "web": {
      const r = rnd();
      if (r < 0.06)
        return [
          "stderr",
          `{"level":"error","time":"${stamp}","msg":"payment provider timeout","route":"/api/orders","durationMs":${3000 + Math.floor(rnd() * 900)}}`,
        ];
      if (r < 0.16)
        return [
          "stdout",
          `{"level":"warn","time":"${stamp}","msg":"slow query","table":"products","durationMs":${200 + Math.floor(rnd() * 400)}}`,
        ];
      return [
        "stdout",
        `{"level":"info","time":"${stamp}","msg":"request completed","method":"${pick(["GET", "GET", "POST"])}","route":"${pick(PATHS)}","status":200,"durationMs":${Math.floor(rnd() * 80) + 3}}`,
      ];
    }
    case "worker":
      return rnd() < 0.1
        ? [
            "stderr",
            `${stamp} WARN job email.send retry 2/5: SMTP connect ECONNREFUSED 172.30.0.4:1025`,
          ]
        : [
            "stdout",
            `${stamp} INFO job ${pick(["invoice.render", "email.send", "stock.sync"])} done in ${Math.floor(rnd() * 900) + 20}ms (#${10_420 + n})`,
          ];
    case "migrate":
      return ["stdout", `${stamp} migrate ${n}`];
    case "postgres":
      return rnd() < 0.2
        ? [
            "stderr",
            `${stamp.replace("T", " ").slice(0, 23)} UTC [${60 + (n % 9)}] LOG:  checkpoint complete: wrote ${Math.floor(rnd() * 90)} buffers (0.5%); 0 WAL file(s) added`,
          ]
        : [
            "stderr",
            `${stamp.replace("T", " ").slice(0, 23)} UTC [${60 + (n % 9)}] LOG:  duration: ${(rnd() * 9).toFixed(3)} ms  statement: SELECT * FROM products WHERE id = $1`,
          ];
    case "redis":
      return [
        "stdout",
        `1:M ${d.toUTCString().slice(5, 25)}.${String(t % 1000).padStart(3, "0")} * ${pick(["1 changes in 3600 seconds. Saving...", "Background saving started by pid 31", "DB saved on disk", "Background saving terminated with success"])}`,
      ];
    case "go":
      if (c.health === "unhealthy")
        return rnd() < 0.5
          ? [
              "stderr",
              `${stamp} ERROR tls: failed to load certificate /certs/server.pem: open /certs/server.pem: no such file or directory`,
            ]
          : ["stderr", `${stamp} WARN listener on :8443 not started; retrying in 5s`];
      return ["stdout", `${stamp} INFO smtp: accepted message from <noreply@shop.local>`];
    case "ollama":
      return [
        "stderr",
        `[GIN] ${d.toISOString().slice(0, 10).replaceAll("-", "/")} - ${d.toISOString().slice(11, 19)} | 200 | ${(rnd() * 4).toFixed(6)}s | 172.30.0.1 | POST "/api/generate"`,
      ];
    case "grafana":
      return [
        "stdout",
        `logger=context userId=1 orgId=1 uname=admin t=${stamp} level=info msg="Request Completed" method=GET path=/api/dashboards/uid/shop status=200 duration=${Math.floor(rnd() * 40)}ms`,
      ];
    case "prometheus":
      return [
        "stderr",
        `ts=${stamp} caller=compact.go:576 level=info component=tsdb msg="write block" duration=${Math.floor(rnd() * 400)}ms`,
      ];
    default:
      return ["stdout", `${stamp} ok`];
  }
}

const MIGRATE = [
  "> shop-api@1.8.0 migrate",
  "> node scripts/migrate.js",
  "",
  "Connecting to postgres://shop:***@db:5432/shop",
  "Applying 20241102_add_orders_index.sql … done (84 ms)",
  "Applying 20241110_cart_items_currency.sql …",
  'error: column "currency" of relation "cart_items" already exists',
  "    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:283:98)",
  "    at Parser.handlePacket (/app/node_modules/pg-protocol/dist/parser.js:122:29)",
  "Migration 20241110_cart_items_currency.sql failed; rolled back.",
  "npm error Lifecycle script `migrate` failed with error:",
  "npm error code 1",
];

/** The last `tail` lines of a container's log, ending at its finish or now. */
export function history(/** @type {any} */ c, /** @type {number} */ tail) {
  const rnd = seeded(c.name.length * 97 + 13);
  if (c.service === "migrate")
    return MIGRATE.map((text, i) => [
      text.startsWith("error") || text.startsWith("npm error") || text.startsWith("    at")
        ? "stderr"
        : "stdout",
      text,
      c.startedAt + i * 900,
    ]);
  const end = c.finishedAt || Date.now();
  const count = Math.min(tail, c.state === "exited" ? 60 : 400);
  const span = Math.min(end - c.startedAt, 3 * 3600_000);
  /** @type {Array<[string, string, number]>} */
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = Math.floor(end - span + (span * i) / Math.max(1, count));
    const [stream, text] = lineOf(c, rnd, t, i);
    out.push([stream, text, t]);
  }
  if (c.kind === "postgres")
    out.unshift([
      "stderr",
      `${new Date(c.startedAt).toISOString().replace("T", " ").slice(0, 23)} UTC [1] LOG:  database system is ready to accept connections`,
      c.startedAt,
    ]);
  if (c.state === "exited" && c.exitCode === 0)
    out.push(["stdout", "Shutting down gracefully…", end]);
  return out;
}
