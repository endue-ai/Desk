// The dashboard's cards under the charts: what needs attention (with a diagnosis by AI), the
// busiest containers, the Compose stacks, disk use with what is reclaimable, and the latest events.

import { meter, segments, sparkline } from "./chart.js";
import { button, dot, h, icon } from "./dom.js";
import { ago, bytes, memory, percent } from "./format.js";
import { problemOf, stateLabel } from "./model.js";

/** @typedef {import("./studio.js").App} App */

/** A card with a heading, an optional link and its body. */
export function card(
  /** @type {string} */ title,
  /** @type {HTMLElement | HTMLElement[]} */ body,
  /** @type {{ cls?: string, action?: HTMLElement | null, sub?: string }} */ options = {},
) {
  return h(
    `article.card${options.cls ? `.${options.cls}` : ""}`,
    null,
    h(
      "header.card-head",
      null,
      h("h2", null, title),
      options.sub ? h("span.card-sub", null, options.sub) : null,
      options.action ?? null,
    ),
    body,
  );
}

const empty = (
  /** @type {string} */ text,
  /** @type {import("./dom.js").IconName} */ name = "check",
) => h("p.card-empty", null, icon(name), text);

/** @param {App} app @param {any} state */
export function attentionCard(app, state) {
  const troubled = state.containers
    .map((/** @type {any} */ c) => ({ c, problem: problemOf(c) }))
    .filter((/** @type {any} */ x) => x.problem)
    .slice(0, 5);
  const body = troubled.length
    ? h(
        "ul.rows",
        null,
        troubled.map(({ c, problem }) =>
          h(
            "li.row",
            null,
            dot(problem.level === "danger" ? "dead" : "restarting", problem.text),
            h(
              "button.desk-btn.desk-btn-quiet.row-main",
              { type: "button", onClick: () => app.open({ kind: "container", id: c.id }) },
              h("b", null, c.name),
              h("small", null, problem.text),
            ),
            button({
              label: "Logs",
              icon: "logs",
              hideLabel: true,
              onClick: () => app.open({ kind: "container", id: c.id, tab: "logs" }),
            }),
            button({
              label: "Diagnose with AI",
              icon: "sparkle",
              kind: "desk-btn-quiet ai",
              onClick: () => app.ai.diagnose(c.id),
            }),
          ),
        ),
      )
    : empty("Every container is healthy.");
  return card("Needs attention", body, {
    cls: "attention",
    sub: troubled.length ? String(troubled.length) : "",
  });
}

/** @param {App} app @param {any} state */
export function consumersCard(app, state) {
  const cores = Math.max(1, state.engine.info?.cpus ?? 1);
  const limit = state.engine.info?.memory ?? 0;
  const rows = state.containers
    .filter((/** @type {any} */ c) => c.state === "running")
    .map((/** @type {any} */ c) => ({ c, s: app.live.history.get(c.id)?.latest }))
    .filter((/** @type {any} */ x) => x.s)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.s.cpu - a.s.cpu)
    .slice(0, 5);
  const hist = (/** @type {string} */ id) => app.live.history.get(id);
  const body = rows.length
    ? [
        h(
          "div.consumer-head",
          { "aria-hidden": "true" },
          h("span", null, "Container"),
          h("span", null, "CPU"),
          h("span", null, "Memory"),
        ),
        h(
          "ul.rows",
          null,
          rows.map(({ c, s }) =>
            h(
              "li.row.consumer",
              null,
              h(
                "button.desk-btn.desk-btn-quiet.row-main",
                {
                  type: "button",
                  onClick: () => app.open({ kind: "container", id: c.id, tab: "stats" }),
                },
                h("b", null, c.name),
                h("small", null, c.image),
              ),
              h(
                "span.use",
                null,
                sparkline(hist(c.id)?.cpu.slice(-30) ?? [], {
                  width: 72,
                  height: 22,
                  color: "--desk-chart-1",
                }),
                meter(s.cpu / 100 / cores, `${c.name} CPU`),
                h("b", null, percent(s.cpu)),
              ),
              h(
                "span.use",
                null,
                sparkline(hist(c.id)?.mem.slice(-30) ?? [], {
                  width: 72,
                  height: 22,
                  color: "--desk-chart-2",
                }),
                meter(limit ? s.mem / limit : 0, `${c.name} memory`),
                h("b", null, memory(s.mem)),
              ),
            ),
          ),
        ),
      ]
    : empty(state.engine.status === "up" ? "Reading resource use…" : "No engine.", "pulse");
  return card("Busiest containers", body, { cls: "consumers" });
}

/** @param {App} app @param {any} state */
export function stacksCard(app, state) {
  /** @type {Map<string, any[]>} */
  const byProject = new Map();
  for (const c of state.containers) {
    if (!c.project) continue;
    const list = byProject.get(c.project) ?? [];
    list.push(c);
    byProject.set(c.project, list);
  }
  for (const p of state.projects) if (!byProject.has(p.name)) byProject.set(p.name, []);
  const names = [...byProject.keys()].sort();
  const body = names.length
    ? h(
        "ul.rows",
        null,
        names.map((name) => {
          const list = byProject.get(name) ?? [];
          const up = list.filter((c) => c.state === "running").length;
          return h(
            "li.row.stack-row",
            null,
            h(
              "button.desk-btn.desk-btn-quiet.row-main",
              { type: "button", onClick: () => app.open({ kind: "project", id: name }) },
              h("b", null, name),
              h(
                "span.service-dots",
                null,
                list.map((c) => dot(c.state, `${c.service || c.name}: ${stateLabel(c)}`)),
              ),
            ),
            h("small.stack-count", null, `${up}/${list.length} running`),
            up > 0
              ? button({
                  label: `Stop ${name}`,
                  icon: "stop",
                  hideLabel: true,
                  onClick: () => app.act.compose("stop", name),
                })
              : button({
                  label: `Start ${name}`,
                  icon: "play",
                  hideLabel: true,
                  onClick: () => app.act.compose("start", name),
                }),
          );
        }),
      )
    : empty("No Compose stacks yet.", "stack");
  return card("Stacks", body, {
    cls: "stacks",
    action: button({ label: "All", kind: "desk-btn-quiet link", onClick: () => app.go("compose") }),
  });
}

/** @param {App} app @param {any} state */
export function diskCard(app, state) {
  const of = (/** @type {string} */ kind) =>
    state.disk.find((/** @type {any} */ d) => d.kind === kind);
  const parts = [
    { name: "Images", kind: "images", color: "--desk-chart-1" },
    { name: "Containers", kind: "containers", color: "--desk-chart-2" },
    { name: "Volumes", kind: "volumes", color: "--desk-chart-3" },
    { name: "Build cache", kind: "cache", color: "--desk-chart-4" },
  ].map((p) => {
    const row = of(p.kind);
    return {
      name: p.name,
      value: row?.size ?? 0,
      color: p.color,
      note: row?.reclaimable ? `${bytes(row.reclaimable)} reclaimable` : "",
    };
  });
  const total = parts.reduce((s, p) => s + p.value, 0);
  const reclaim = state.disk.reduce(
    (/** @type {number} */ s, /** @type {any} */ d) => s + d.reclaimable,
    0,
  );
  const body = state.disk.length
    ? h(
        "div.disk",
        null,
        h("p.disk-total", null, h("b", null, bytes(total)), h("span", null, " used by Docker")),
        segments(parts, (v) => bytes(v), "Disk used by Docker"),
        reclaim > 0
          ? button({
              label: `Clean up ${bytes(reclaim)}`,
              icon: "broom",
              kind: "desk-btn-primary",
              onClick: () => app.dialogs.cleanup(),
            })
          : null,
      )
    : empty("Reading disk use…", "disk");
  return card("Disk", body, { cls: "disk-card" });
}

const VERBS = /** @type {Record<string, string>} */ ({
  create: "created",
  start: "started",
  stop: "stopped",
  die: "exited",
  kill: "killed",
  pause: "paused",
  unpause: "resumed",
  restart: "restarted",
  destroy: "removed",
  remove: "removed",
  oom: "ran out of memory",
  health_status: "health",
  rename: "renamed",
  pull: "pulled",
  push: "pushed",
  tag: "tagged",
  untag: "untagged",
  delete: "deleted",
  load: "loaded",
  import: "imported",
  save: "saved",
});

const ICON = /** @type {Record<string, import("./dom.js").IconName>} */ ({
  container: "container",
  image: "image",
  volume: "volume",
  network: "network",
});

/** @param {App} app @param {any} state */
export function activityCard(_app, state) {
  const now = Date.now();
  const list = state.activity.slice(0, 8);
  const body = list.length
    ? h(
        "ol.activity",
        null,
        list.map((/** @type {any} */ a) =>
          h(
            `li.act.act-${a.action}`,
            null,
            h("span.act-icon", null, icon(ICON[a.kind] ?? "info", 14)),
            h(
              "span.act-text",
              null,
              h("b", null, a.name || a.id.slice(0, 12)),
              ` ${VERBS[a.action] ?? a.action}`,
              a.detail ? h("small", null, ` · ${a.detail}`) : null,
            ),
            h("time", { datetime: new Date(a.time).toISOString() }, ago(a.time, now)),
          ),
        ),
      )
    : empty("Events show here as they happen.", "clock");
  return card("Activity", body, { cls: "activity-card", sub: "live" });
}
