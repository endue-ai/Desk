// Canned answers for brain.ask in the preview (?brain=demo), by tool name, so screenshots show what
// the assistant draws for the seeded engine. Never loaded by the desk.

export const DEMO_ANSWERS = {
  diagnose_container: {
    headline: "The migration adds a column that already exists, so npm run migrate exits with 1.",
    cause:
      "`20241110_cart_items_currency.sql` runs `ALTER TABLE cart_items ADD COLUMN currency`, but the column is already there — most likely added by hand or by an earlier run that was not recorded in the migrations table. Postgres refuses, the migration rolls back and the `migrate` service stops with exit code 1. The database itself is healthy.",
    evidence: [
      'error: column "currency" of relation "cart_items" already exists',
      "Migration 20241110_cart_items_currency.sql failed; rolled back.",
      "npm error Lifecycle script `migrate` failed with error: npm error code 1",
    ],
    fixes: [
      {
        title: "Make the migration safe to run twice",
        detail:
          "Change the statement to `ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';` and run the migration again.",
        command: {
          title: "Run the migration again",
          args: ["compose", "--project-name", "shop", "start", "migrate"],
        },
      },
      {
        title: "Or record it as applied",
        detail:
          "If the column is right as it is, insert the migration's name into the migrations table so it is skipped: `INSERT INTO schema_migrations (name) VALUES ('20241110_cart_items_currency');`.",
      },
      {
        title: "Read the database's side",
        detail: "Check what the column looks like now before choosing.",
        command: {
          title: "Show the table's columns",
          args: ["exec", "shop-db-1", "psql", "-U", "shop", "-d", "shop", "-c", "\\d cart_items"],
        },
      },
    ],
    confidence: "high",
  },
  explain_logs: {
    summary:
      "The API serves most requests in under 100 ms, but **calls to the payment provider time out** about once a minute, and product queries are slow now and then.",
    issues: [
      {
        title: "Payment provider timeouts on /api/orders",
        severity: "error",
        lines: [
          '{"level":"error","msg":"payment provider timeout","route":"/api/orders","durationMs":3679}',
        ],
        suggestion:
          "The provider is `payments-sandbox`, which is unhealthy: its TLS certificate is missing. Fix that container first; then lower the client timeout and retry with backoff.",
      },
      {
        title: "Slow queries on products",
        severity: "warning",
        lines: ['{"level":"warn","msg":"slow query","table":"products","durationMs":253}'],
        suggestion:
          "Add an index on the column the query filters by, e.g. `CREATE INDEX ON products (category_id);`.",
      },
    ],
  },
  slim_image: {
    summary:
      "Most of the 412 MB is the full `node_modules` and the Alpine toolchain added for native builds.",
    savings: "about 180 MB",
    suggestions: [
      {
        title: "Build in one stage, run in another",
        detail:
          "Install with the toolchain in a `build` stage and copy only `/app` and the production `node_modules` into a fresh `node:22-alpine` stage.",
      },
      {
        title: "Drop libstdc++ and its friends from the runtime",
        detail:
          "The 121 MB `RUN apk add` layer is only needed to compile native modules; keep it in the build stage.",
      },
      {
        title: "Keep the context small",
        detail:
          "Add `node_modules`, `.git` and `coverage` to `.dockerignore`; the 3 MB `COPY . .` layer shrinks and builds stop missing the cache.",
      },
    ],
  },
  explain_build_failure: {
    headline: "npm ci needs a package-lock.json, and the context has none.",
    cause:
      "The step `RUN npm ci --omit=dev` stops because `.dockerignore` leaves out `package-lock.json`.",
    fixes: [
      {
        title: "Let the lock file in",
        detail: "Remove `package-lock.json` from `.dockerignore`, or use `npm install --omit=dev`.",
      },
    ],
  },
  write_docker_files: {
    notes:
      "Next.js wants its standalone output: the build stage runs `next build`, the runtime copies `.next/standalone` and `.next/static` only.",
    files: [
      {
        name: "Dockerfile",
        content:
          'FROM node:22-alpine AS build\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci\nCOPY . .\nRUN npx prisma generate && npm run build\n\nFROM node:22-alpine\nENV NODE_ENV=production\nWORKDIR /app\nCOPY --from=build /app/.next/standalone ./\nCOPY --from=build /app/.next/static ./.next/static\nUSER node\nEXPOSE 3000\nCMD ["node", "server.js"]\n',
      },
    ],
  },
  answer: {
    answer:
      "**ollama** uses the most memory by far — about **1.9 GiB** of the 2.7 GiB your containers use now, to keep `llama3.2-3b` loaded. Next come `shop-api-1` (176 MiB) and `observability-prometheus-1` (113 MiB).\n\nIf you do not need the model loaded, stop the container; its models stay in the `ollama_models` volume.",
    commands: [
      { title: "Stop ollama", args: ["stop", "ollama"] },
      { title: "See memory use once", args: ["stats", "--no-stream"] },
    ],
  },
};
