// The runner's tab: on the left what runs (the requests, ticked, in order), how many times, with
// which data rows and pause, and whether to stop at a failure; on the right the run as it goes,
// its totals, a bar per request's time coloured by its outcome, and every row with what failed.

import { button, h, icon, methodBadge } from "./dom.js";
import { bytes, duration, statusClass } from "./format.js";
import { methodClass } from "./model.js";
import { parseData, reportMarkdown, requestsOf, startRun, summarize } from "./runner.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./runner.js").RunRow} RunRow
 * @typedef {{ skip: Set<string>, iterations: number, delayMs: number, stopOnFail: boolean,
 *   dataText: string, dataName: string, rows: RunRow[], running?: { stop(): void }, now?: string,
 *   host?: HTMLElement }} RunnerState
 */

/** @type {WeakMap<Tab, RunnerState>} */
const states = new WeakMap();

/** @param {Studio} S @param {Tab} tab */
export function runnerPane(S, tab) {
  const coll = tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
  if (!coll || !tab.ref)
    return {
      el: h("div.as-res-empty", null, h("h3", null, "That collection is not open any more.")),
    };
  const folder =
    tab.ref.path === coll.path ? undefined : S.collections.locate(coll, tab.ref.path)?.node;
  const items = requestsOf(folder?.type === "folder" ? folder.children : coll.children);
  const state = states.get(tab) ?? {
    skip: new Set(),
    iterations: 1,
    delayMs: 0,
    stopOnFail: false,
    dataText: "",
    dataName: "",
    rows: [],
  };
  states.set(tab, state);
  const host = state.host ?? h("div.as-runner");
  state.host = host;
  const redraw = () => void runnerPane(S, tab);

  // ── what runs ──
  const list = h(
    "div.as-run-list",
    null,
    ...items.map((item) => {
      const box = /** @type {HTMLInputElement} */ (
        h("input.desk-check", {
          type: "checkbox",
          checked: !state.skip.has(item.path),
          "aria-label": `Run ${item.name}`,
        })
      );
      box.addEventListener("change", () => {
        if (box.checked) state.skip.delete(item.path);
        else state.skip.add(item.path);
        count.textContent = `${items.length - state.skip.size} of ${items.length}`;
      });
      return h(
        "label.as-run-item",
        null,
        box,
        methodBadge(item.method, methodClass(item.method)),
        h("span.as-run-name", null, item.name),
        item.folder ? h("span.as-run-folder", null, item.folder) : null,
      );
    }),
  );
  const count = h("span.as-hint", null, `${items.length - state.skip.size} of ${items.length}`);
  /** @param {string} label @param {string} key @param {number} min @param {number} max */
  const number = (label, key, min, max) => {
    const input = /** @type {HTMLInputElement} */ (
      h("input.desk-field.as-number", {
        type: "number",
        min,
        max,
        value: String(/** @type {any} */ (state)[key]),
        "aria-label": label,
      })
    );
    input.addEventListener("input", () => {
      /** @type {any} */ (state)[key] = Math.max(
        min,
        Math.min(max, Math.round(Number(input.value) || 0)),
      );
    });
    return h("label.as-run-opt", null, h("span", null, label), input);
  };
  const stop = /** @type {HTMLInputElement} */ (
    h("input.desk-check", { type: "checkbox", checked: state.stopOnFail })
  );
  stop.addEventListener("change", () => {
    state.stopOnFail = stop.checked;
  });
  /** @type {Record<string, string>[]} */
  let data = [];
  let dataProblem = "";
  try {
    data = parseData(state.dataText);
  } catch (error) {
    dataProblem = String(/** @type {Error} */ (error).message);
  }
  const dataArea = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.as-run-data", {
      spellcheck: "false",
      placeholder:
        "email,password\nada@example.com,s3cret\nbo@example.com,hunter2\n\nor a JSON array of objects",
      "aria-label": "Data rows",
    })
  );
  dataArea.value = state.dataText;
  dataArea.addEventListener("change", () => {
    state.dataText = dataArea.value;
    redraw();
  });
  const pickData = button({
    label: "Choose a file…",
    icon: "file",
    kind: "desk-btn-quiet",
    onClick: async () => {
      const chosen = await S.ctx.bridge
        .call("dialog.open", {
          title: "A CSV or JSON data file",
          filters: [{ name: "Data", extensions: ["csv", "json"] }],
        })
        .catch(() => undefined);
      const path = chosen?.cancelled ? undefined : chosen?.paths?.[0];
      if (!path) return;
      try {
        const read = await S.ctx.bridge.call("fs.read", {
          path,
          encoding: "utf8",
          scope: { permission: "fs:read", paths: [path] },
        });
        state.dataText = String(read?.content ?? "");
        state.dataName = path.split("/").pop() ?? path;
        redraw();
      } catch (error) {
        S.app.toast(
          `Could not read it: ${String(/** @type {any} */ (error)?.message ?? error)}`,
          "error",
        );
      }
    },
  });

  const config = h(
    "div.as-run-config",
    null,
    h(
      "div.as-run-card",
      null,
      h("div.as-run-card-head", null, h("h3", null, "Requests"), count),
      list,
    ),
    h(
      "div.as-run-card",
      null,
      h("div.as-run-card-head", null, h("h3", null, "Options")),
      number("Iterations", "iterations", 1, 1000),
      number("Pause between requests (ms)", "delayMs", 0, 60000),
      h("label.as-run-opt", null, h("span", null, "Stop at the first failure"), stop),
    ),
    h(
      "div.as-run-card",
      null,
      h(
        "div.as-run-card-head",
        null,
        h("h3", null, "Data rows"),
        state.dataName ? h("span.as-hint", null, state.dataName) : null,
        h("span.as-grow"),
        pickData,
      ),
      dataArea,
      h(
        `p.as-hint${dataProblem ? ".as-bad" : ""}`,
        null,
        dataProblem ||
          (data.length
            ? `${data.length} rows: iteration n uses row n, as {{${Object.keys(data[0] ?? {}).join("}}, {{")}}}.`
            : "Each row's columns become variables for one iteration."),
      ),
    ),
  );

  // ── the run ──
  const s = summarize(state.rows);
  const max = Math.max(1, ...state.rows.map((r) => r.time));
  const outcome = (/** @type {RunRow} */ r) =>
    r.error || !r.status ? "server" : r.failed ? "client" : statusClass(r.status);
  const results = h(
    "div.as-run-results",
    null,
    h(
      "div.as-run-stats",
      null,
      ...[
        [String(s.requests), "requests"],
        [String(s.failedRequests), "failed", s.failedRequests ? "is-bad" : ""],
        [
          `${s.passed}/${s.passed + s.failed}`,
          "checks passed",
          s.failed ? "is-bad" : s.passed ? "is-ok" : "",
        ],
        [duration(s.average), "average"],
        [duration(s.total), "in all"],
      ].map(([n, label, cls]) =>
        h(
          `div.as-stat-card${cls ? `.${cls}` : ""}`,
          null,
          h("strong", null, n),
          h("span", null, label),
        ),
      ),
    ),
    state.rows.length
      ? h(
          "div.as-run-chart",
          { "aria-label": "Each request's time" },
          ...state.rows.map((r) =>
            h(`span.as-run-bar.s-${outcome(r)}`, {
              style: { height: `${Math.max(4, (r.time / max) * 100)}%` },
              title: `${r.item.name} #${r.iteration}: ${r.time} ms`,
            }),
          ),
        )
      : null,
    state.now ? h("div.as-run-now", null, h("span.as-spin"), h("span", null, state.now)) : null,
    state.rows.length
      ? h(
          "div.as-run-table",
          null,
          ...state.rows.map((r) =>
            h(
              `details.as-run-row${r.failures.length || r.error ? ".is-bad" : ""}`,
              null,
              h(
                "summary",
                null,
                h("span.as-run-n", null, `#${r.iteration}`),
                methodBadge(r.item.method, methodClass(r.item.method)),
                h("span.as-run-name", null, r.item.name),
                h(`span.status-pill.s-${outcome(r)}`, null, r.status ? String(r.status) : "Error"),
                h("span.as-run-time", null, duration(r.time)),
                h("span.as-run-size", null, bytes(r.size)),
                h(
                  `span.as-run-checks${r.failed ? ".is-bad" : ".is-ok"}`,
                  null,
                  r.failed ? `✗ ${r.failed}` : r.passed ? `✓ ${r.passed}` : "—",
                ),
              ),
              h(
                "div.as-run-fails",
                null,
                ...[...(r.error ? [r.error] : []), ...r.failures].map((f) =>
                  h("div", null, icon("x", 12), f),
                ),
                button({
                  label: "Open the request",
                  icon: "send",
                  kind: "desk-btn-quiet",
                  onClick: () =>
                    S.openNode(coll, {
                      type: "request",
                      path: r.item.path,
                      name: r.item.name,
                      method: r.item.method,
                      seq: 0,
                      req: r.item.req,
                    }),
                }),
              ),
            ),
          ),
        )
      : h(
          "div.as-res-empty",
          null,
          h("div.as-res-empty-art", null, icon("runner", 28)),
          h("h3", null, "Run the requests in order"),
          h(
            "p.as-hint",
            null,
            "Scripts, captures, checks and tests run for each one, as when sent by hand.",
          ),
        ),
  );

  const run = async () => {
    const chosen = items.filter((i) => !state.skip.has(i.path));
    if (!chosen.length) return S.app.toast("Tick at least one request.", "error");
    state.rows = [];
    const running = startRun(
      S,
      coll,
      chosen,
      { iterations: state.iterations, delayMs: state.delayMs, stopOnFail: state.stopOnFail, data },
      {
        onStart: (i, item) => {
          state.now = `#${i} ${item.method} ${item.name}`;
          if (S.app.current() === tab) redraw();
        },
        onRow: (row) => {
          state.rows.push(row);
        },
      },
    );
    state.running = running;
    redraw();
    await running.promise;
    state.running = undefined;
    state.now = undefined;
    if (S.app.current() === tab) redraw();
    const sum = summarize(state.rows);
    S.app.toast(
      `Run finished: ${sum.requests} requests, ${sum.failedRequests} failed`,
      sum.failedRequests ? "error" : "ok",
    );
  };
  const title = `${coll.name}${folder ? ` / ${folder.name}` : ""}`;
  const head = h(
    "div.as-group-head",
    null,
    h("span.as-group-icon", null, icon("runner", 20)),
    h(
      "div.as-group-title",
      null,
      h("strong.as-run-title", null, `Run ${title}`),
      h(
        "span.as-group-path",
        null,
        `${items.length} requests · environment ${S.envs?.activeEnv(coll)?.name ?? "none"}`,
      ),
    ),
    h("span.as-grow"),
    state.rows.length && !state.running
      ? button({
          label: "Copy report",
          icon: "copy",
          kind: "desk-btn-quiet",
          onClick: () =>
            S.copy(reportMarkdown(`Run of ${title}`, state.rows), "Report copied as Markdown"),
        })
      : null,
    state.running
      ? button({
          label: "Stop",
          icon: "stop",
          kind: "desk-btn-danger",
          onClick: () => state.running?.stop(),
        })
      : button({ label: "Run", icon: "play", kind: "desk-btn-primary", onClick: () => void run() }),
  );
  host.replaceChildren(head, h("div.as-run-body", null, config, results));
  return { el: host };
}
