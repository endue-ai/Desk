// The panels of the detail pane, without the pane around them: a container's Info, Env, Ports,
// Stats and Files, an image's Info and History, and an operation's output. Each returns the rows
// of the panel's cursor (tree.js) and the nodes to draw.

import { el, empty, heading, row, span } from "./dom.js";
import { formatBytes } from "./overview.js";
import { portText } from "./parse-list.js";
import { portUrl } from "./ports.js";
import { cpuText, rateText, sparkline } from "./sparkline.js";

/**
 * @typedef {import("./tree.js").RowSpec} RowSpec
 * @typedef {import("./pane.js").FullDetail} FullDetail
 * @typedef {{ rows: RowSpec[], nodes?: Node[], focus?: HTMLElement }} Panel
 */

/** A label and a value. */
export const field = (
  /** @type {Document} */ doc,
  /** @type {string} */ section,
  /** @type {string} */ label,
  /** @type {string} */ value,
  /** @type {string} */ classes = "",
) =>
  row(doc, `field ${classes}`.trim(), { kind: "field", section, label }, 2, [
    el(doc, "span", { class: "label", title: label }, label),
    el(doc, "span", { class: "value", title: value }, value),
  ]);

/** Info: every section of the detail but the ones with tabs of their own, each folding. */
export function renderInfo(
  /** @type {Document} */ doc,
  /** @type {FullDetail | null | undefined} */ detail,
  /** @type {Set<string>} */ folded,
) {
  if (!detail) return { rows: [empty(doc, "Reading the container…")] };
  /** @type {RowSpec[]} */
  const rows = [];
  for (const section of detail.sections) {
    if (section.id === "env" || section.id === "ports") continue;
    const key = `detail:${section.id}`;
    rows.push(heading(doc, key, section.title, folded, String(section.fields.length)));
    if (folded.has(key)) continue;
    for (const f of section.fields)
      rows.push(field(doc, section.id, f.label, f.value, f.masked ? "masked" : ""));
  }
  return { rows };
}

/** Env: the environment, secret-looking values masked. */
export function renderEnv(
  /** @type {Document} */ doc,
  /** @type {FullDetail | null | undefined} */ detail,
) {
  const env = detail?.sections.find((s) => s.id === "env")?.fields ?? [];
  if (env.length === 0)
    return { rows: [empty(doc, detail ? "No environment variables." : "Reading the container…")] };
  return { rows: env.map((f) => field(doc, "env", f.label, f.value, f.masked ? "masked" : "")) };
}

/** Ports: each binding, a link when it opens in the browser (Enter or w). */
export function renderPorts(
  /** @type {Document} */ doc,
  /** @type {FullDetail | null | undefined} */ detail,
) {
  const ports = detail?.ports ?? [];
  if (ports.length === 0)
    return {
      rows: [empty(doc, detail ? "This container publishes no port." : "Reading the container…")],
    };
  return {
    rows: ports.map((p) => {
      const url = portUrl(p);
      const inside = `${p.container}/${p.proto}`;
      const where = p.host ? portText(p) : "not published";
      return row(
        doc,
        `field port-row${url ? " link" : ""}`,
        { kind: "field", section: "ports", label: p.host || inside },
        1,
        [
          span(doc, "label", inside),
          url
            ? el(
                doc,
                "a",
                {
                  class: "port",
                  href: url,
                  "data-container": detail?.id ?? "",
                  "data-port": p.host,
                  tabindex: "-1",
                },
                url,
              )
            : span(doc, "value desk-muted", where),
        ],
        undefined,
        { key: `port:${p.host}:${inside}` },
      );
    }),
  };
}

/** Stats: CPU, memory and network as charts of the last minutes, and the latest numbers. */
export function renderStats(
  /** @type {Document} */ doc,
  /** @type {import("./stats.js").Snapshot | undefined} */ snap,
  /** @type {string} */ state,
) {
  if (!snap)
    return {
      rows: [
        empty(
          doc,
          state === "running" || state === ""
            ? "Waiting for docker stats…"
            : "Resource use shows while the container runs.",
        ),
      ],
    };
  const chart = (
    /** @type {string} */ kind,
    /** @type {string} */ title,
    /** @type {string} */ now,
    /** @type {number[]} */ values,
    /** @type {number} */ max,
    /** @type {string} */ note,
  ) =>
    row(
      doc,
      `chart ${kind}`,
      { kind: "field", section: "stats", label: title },
      1,
      [
        el(
          doc,
          "div",
          { class: "chart-head" },
          span(doc, "label", title),
          span(doc, "value", now),
          span(doc, "desk-muted", note),
        ),
        sparkline(doc, values, {
          kind,
          label: `${title} ${now}`,
          width: 320,
          height: 64,
          max,
          slots: 60,
        }),
      ],
      undefined,
      { key: `chart:${kind}` },
    );
  const memUsed = snap.latest.memText.split("/")[0]?.trim() ?? "";
  const limit = snap.latest.memText.split("/")[1]?.trim() ?? "";
  return {
    rows: [
      chart("cpu", "CPU", cpuText(snap.latest.cpu), snap.cpu, 100, "of one core = 100%"),
      chart(
        "mem",
        "Memory",
        memUsed,
        snap.mem,
        snap.memLimit || Math.max(...snap.mem, 1),
        limit ? `of ${limit} (${snap.latest.memPerc.toFixed(1)}%)` : "",
      ),
      chart(
        "net",
        "Network",
        rateText(snap.rate),
        snap.net,
        1000,
        `in / out so far ${snap.latest.net}`,
      ),
      field(doc, "stats", "Processes", String(snap.latest.pids)),
      field(doc, "stats", "Disk in / out", snap.latest.block),
    ],
  };
}

const KIND_MARK = /** @type {Record<string, string>} */ ({
  dir: "▸",
  link: "↪",
  file: "",
  other: "◇",
});

/** Files: the folder's path, its parent, and its entries; the panel takes drops (drop.js). */
export function renderFiles(
  /** @type {Document} */ doc,
  /** @type {import("./pane.js").Files | null | undefined} */ files,
  /** @type {string} */ container,
  name = "",
) {
  const path = files?.path ?? "/";
  /** @type {RowSpec[]} */
  const rows = [];
  if (path !== "/")
    rows.push(
      row(
        doc,
        "entry up",
        { kind: "entry", path: path.slice(0, path.lastIndexOf("/")) || "/", dir: true },
        1,
        [
          span(doc, "mark", "↰"),
          span(doc, "name", ".."),
          span(doc, "desk-muted", "the folder above"),
        ],
        undefined,
        { key: "entry:.." },
      ),
    );
  for (const e of files?.entries ?? [])
    rows.push(
      row(
        doc,
        `entry ${e.kind}`,
        { kind: "entry", path: e.path, dir: e.kind === "dir" || e.kind === "link" },
        1,
        [
          span(doc, "mark", KIND_MARK[e.kind] ?? ""),
          el(
            doc,
            "span",
            { class: "name", title: e.target ? `${e.name} → ${e.target}` : e.name },
            e.name,
          ),
          e.target ? span(doc, "target desk-muted", `→ ${e.target}`) : undefined,
          span(doc, "size", e.size ? formatBytes(Number(e.size)) : ""),
          span(doc, "modified desk-muted", e.modified),
          span(doc, "mode desk-muted", e.mode),
        ],
        undefined,
        { key: `entry:${e.path}` },
      ),
    );
  if (files?.problem) rows.push(empty(doc, files.problem));
  else if (files && !files.loading && files.entries.length === 0)
    rows.push(empty(doc, "This folder is empty. Y copies a file of this computer into it."));
  else if (!files || files.loading) rows.push(empty(doc, "Reading the folder…"));
  const crumbs = el(
    doc,
    "p",
    { class: "crumbs", "aria-label": "Folder" },
    span(doc, "path", path),
    span(doc, "desk-muted", "  ↵ open · ⌫ up · y copy out · Y copy in"),
  );
  const list = el(
    doc,
    "div",
    {
      class: "files",
      "data-drop": "files",
      "data-container": container,
      "data-name": name,
      "data-path": path,
    },
    ...rows.map((r) => r.el),
  );
  return { rows, nodes: [crumbs, list] };
}

/** An image's Info: what it is and what a container from it runs. */
export function renderImageInfo(
  /** @type {Document} */ doc,
  /** @type {import("./pane.js").PaneModel["image"]} */ image,
) {
  const info = image?.info;
  if (!info) return { rows: [empty(doc, "Reading the image…")] };
  const pairs = /** @type {Array<[string, string]>} */ ([
    ["Id", info.id],
    ["Platform", [info.os, info.arch].filter(Boolean).join("/")],
    ["Created", info.created],
    ["Size", formatBytes(info.size)],
    ["Layers", String(info.layers)],
    ["Entrypoint", info.entrypoint],
    ["Command", info.cmd],
    ["Working dir", info.workdir],
    ["User", info.user],
    ["Exposes", info.ports.join(", ")],
    ...info.env.map((e) => /** @type {[string, string]} */ (["Env", e])),
    ...info.labels.map(([k, v]) => /** @type {[string, string]} */ ([k, v])),
  ]);
  return {
    rows: pairs
      .filter(([, v]) => v !== "")
      .map(([label, value]) => field(doc, "image", label, value)),
  };
}

/** History: the layers, newest first, each with its size against the largest. */
export function renderHistory(
  /** @type {Document} */ doc,
  /** @type {import("./pane.js").PaneModel["image"]} */ image,
) {
  const layers = image?.layers ?? [];
  if (layers.length === 0)
    return {
      rows: [empty(doc, image ? "docker keeps no history for this image." : "Reading the image…")],
    };
  const largest = Math.max(1, ...layers.map((l) => l.bytes));
  return {
    rows: layers.map((l, i) => {
      const bar = el(
        doc,
        "span",
        { class: "bar", "aria-hidden": "true" },
        el(doc, "span", { class: "fill" }),
      );
      /** @type {HTMLElement} */ (bar.firstChild).style.width =
        `${l.bytes ? Math.max(2, Math.round((l.bytes / largest) * 100)) : 0}%`;
      return row(
        doc,
        `layer${l.bytes === 0 ? " empty-layer" : ""}`,
        { kind: "field", section: "history", label: String(i) },
        1,
        [
          el(doc, "span", { class: "size" }, bar, span(doc, "value", l.size)),
          el(doc, "span", { class: "created-by", title: l.createdBy }, l.createdBy),
          span(
            doc,
            "created desk-muted",
            l.created.replace("T", " ").replace(/[+-]\d{2}:\d{2}$|Z$/, ""),
          ),
        ],
        undefined,
        { key: `layer:${i}` },
      );
    }),
  };
}

/** An operation's output: its progress, what it says now, and every line it wrote. */
export function renderOutput(
  /** @type {Document} */ doc,
  /** @type {import("./pane.js").Op | undefined} */ op,
) {
  if (!op) return { rows: [] };
  const progress = /** @type {HTMLProgressElement} */ (
    el(doc, "progress", { class: "desk-progress", "aria-label": "Progress" })
  );
  if (op.progress.total > 0) {
    progress.max = op.progress.total;
    progress.value = op.state === "done" ? op.progress.total : op.progress.done;
  } else if (op.state === "done") {
    progress.max = 1;
    progress.value = 1;
  }
  const status =
    op.state === "failed"
      ? op.error || "It failed."
      : op.state === "done"
        ? "Done."
        : op.progress.status || "Working…";
  const head = el(
    doc,
    "div",
    { class: `op-head state-${op.state}` },
    progress,
    el(
      doc,
      "p",
      { class: "op-status", role: "status" },
      op.progress.total ? `${status} · ${op.progress.done}/${op.progress.total}` : status,
    ),
  );
  const lines = el(
    doc,
    "pre",
    { class: "op-lines", role: "log", tabindex: "0", "aria-label": "Output" },
    op.lines.join("\n"),
  );
  return { rows: [], nodes: [head, lines], focus: lines };
}
