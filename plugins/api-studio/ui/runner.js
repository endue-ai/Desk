// Running many requests in a row: a collection's or folder's requests in their order, as many
// times as asked, each time with the next row of a data file as variables, a pause between
// requests, and an optional stop at the first failure. Each request goes through the same send
// as a tab (scripts, captures, checks and tests included) without touching the history.

import { clone } from "./model.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 * @typedef {{ path: string, name: string, method: string, folder: string, req: import("./model.js").Request }} RunItem
 * @typedef {{ iteration: number, item: RunItem, status: number, reason: string, time: number,
 *   size: number, passed: number, failed: number, error?: string, failures: string[], at: number }} RunRow
 * @typedef {{ iterations: number, delayMs: number, stopOnFail: boolean, data: Record<string, string>[] }} RunOptions
 */

/** The requests under a folder (or a whole collection), depth first, in their order. @param {Node[]} nodes @param {string} folder */
export function requestsOf(nodes, folder = "") {
  /** @type {RunItem[]} */
  const out = [];
  for (const n of nodes) {
    if (n.type === "request")
      out.push({ path: n.path, name: n.name, method: n.method, folder, req: n.req });
    else out.push(...requestsOf(n.children, folder ? `${folder} / ${n.name}` : n.name));
  }
  return out;
}

/** Rows of a CSV text as objects keyed by its header row (quotes, "" escapes, CRLF). @param {string} text */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head = [], ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return body.map((r) => Object.fromEntries(head.map((k, i) => [k.trim(), r[i] ?? ""])));
}

/** A data file's rows: a JSON array of objects, or CSV. @param {string} text */
export function parseData(text) {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    const list = JSON.parse(t);
    if (!Array.isArray(list)) throw new Error("A JSON data file holds an array of objects.");
    return list.map((/** @type {unknown} */ o) =>
      Object.fromEntries(
        Object.entries(o && typeof o === "object" ? o : {}).map(([k, v]) => [
          k,
          typeof v === "string" ? v : JSON.stringify(v),
        ]),
      ),
    );
  }
  return parseCsv(t);
}

/**
 * Run items. `onRow` hears each result as it comes; `stop()` ends the run after the request in
 * flight. Resolves with every row.
 * @param {Studio} S @param {Collection} coll @param {RunItem[]} items @param {RunOptions} options
 * @param {{ onRow(row: RunRow): void, onStart?(iteration: number, item: RunItem): void }} hooks
 */
export function startRun(S, coll, items, options, hooks) {
  let stopped = false;
  /** @type {{ cancel(): void } | undefined} */
  let current;
  /** @type {RunRow[]} */
  const rows = [];
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  const promise = (async () => {
    const times = Math.max(
      1,
      options.data.length ? Math.max(options.iterations, options.data.length) : options.iterations,
    );
    outer: for (let i = 0; i < times; i++) {
      const data = options.data.length ? (options.data[i % options.data.length] ?? {}) : {};
      for (const item of items) {
        if (stopped) break outer;
        hooks.onStart?.(i + 1, item);
        /** @type {import("./app.js").Tab} */
        const tab = {
          id: `run-${i}-${item.path}`,
          req: clone(item.req),
          saved: null,
          ref: { collection: coll.path, path: item.path },
          reqTab: "params",
          resTab: "body",
          quiet: true,
          data,
        };
        const sending = S.send(tab);
        current = { cancel: () => S.cancel(tab) };
        await sending;
        const res = tab.response;
        const r = tab.results;
        const failures = [
          ...(r?.tests ?? []).filter((t) => !t.ok).map((t) => `${t.name}: ${t.error ?? "failed"}`),
          ...(r?.asserts ?? []).filter((a) => !a.ok).map((a) => `${a.target}: ${a.message}`),
          ...(r?.errors ?? []).map((e) => e.text),
        ];
        /** @type {RunRow} */
        const row = {
          iteration: i + 1,
          item,
          status: res?.status ?? 0,
          reason: res?.reason ?? "",
          time: Math.round(res?.timings.total ?? 0),
          size: res?.size ?? 0,
          passed: [...(r?.tests ?? []), ...(r?.asserts ?? [])].filter((t) => t.ok).length,
          failed: failures.length,
          failures,
          ...(res?.error ? { error: res.error } : {}),
          at: Date.now(),
        };
        rows.push(row);
        hooks.onRow(row);
        if (options.stopOnFail && (row.failed || row.error || row.status >= 400)) {
          stopped = true;
          break outer;
        }
        if (options.delayMs > 0 && !stopped) await sleep(options.delayMs);
      }
    }
    return rows;
  })();
  return {
    promise,
    stop() {
      stopped = true;
      current?.cancel();
    },
  };
}

/** A run's totals. @param {RunRow[]} rows */
export function summarize(rows) {
  const failedRequests = rows.filter(
    (r) => r.failed || r.error || r.status >= 400 || !r.status,
  ).length;
  const times = rows.map((r) => r.time);
  return {
    requests: rows.length,
    failedRequests,
    passed: rows.reduce((n, r) => n + r.passed, 0),
    failed: rows.reduce((n, r) => n + r.failed, 0),
    total: times.reduce((a, b) => a + b, 0),
    average: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    slowest: Math.max(0, ...times),
  };
}

/** A run as Markdown, for a pull request or a chat. @param {string} title @param {RunRow[]} rows */
export function reportMarkdown(title, rows) {
  const s = summarize(rows);
  const lines = [
    `## ${title}`,
    "",
    `${s.requests} requests, ${s.failedRequests} failed · ${s.passed} checks passed, ${s.failed} failed · ${s.total} ms in all, ${s.average} ms on average`,
    "",
    "| # | Request | Status | Time | Checks |",
    "|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.iteration} | ${r.item.method} ${r.item.folder ? `${r.item.folder} / ` : ""}${r.item.name} | ${r.status || "error"} | ${r.time} ms | ${r.failed ? `✗ ${r.failed} failed` : `✓ ${r.passed}`} |`,
    ),
  ];
  const failing = rows.filter((r) => r.failures.length || r.error);
  if (failing.length) {
    lines.push("", "### Failures", "");
    for (const r of failing)
      for (const f of [...(r.error ? [r.error] : []), ...r.failures])
        lines.push(`- ${r.item.name} (#${r.iteration}): ${f}`);
  }
  return `${lines.join("\n")}\n`;
}
