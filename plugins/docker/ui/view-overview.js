// The overview the surface opens on, as cards: the engine, containers by state, the Compose stacks,
// the busiest containers, disk use with what could be reclaimed, images, volumes and networks. Every
// line that leads somewhere is a row of one cursor (arrows, Enter): a list filtered, or an action.

import { el, row, span, stateDot } from "./dom.js";
import { formatBytes } from "./overview.js";
import { cpuText, sparkline } from "./sparkline.js";

/**
 * @typedef {import("./view-lists.js").Spec} Spec
 * @typedef {import("./overview.js").Overview} Overview
 * @typedef {import("./docker.js").StatsRead} StatsRead
 */

const plural = (/** @type {number} */ n, /** @type {string} */ noun) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A row that opens a list filtered by `query`, or (a list starting with @) runs an action. */
const go = (
  /** @type {Document} */ doc,
  /** @type {string} */ classes,
  /** @type {string} */ list,
  /** @type {string} */ query,
  /** @type {(Node | string | undefined)[]} */ children,
) =>
  /** @type {Spec} */ (
    row(doc, `go ${classes}`, { kind: "goto", list, query }, 1, children, undefined, {
      key: `go:${list}:${query}:${classes}`,
    })
  );

/** A card: its title and what it holds; its rows join the one cursor. */
function card(
  /** @type {Document} */ doc,
  /** @type {string} */ id,
  /** @type {string} */ title,
  /** @type {string} */ note,
  /** @type {(Node | undefined)[]} */ body,
) {
  return el(
    doc,
    "section",
    { class: `card desk-card ${id}`, role: "group", "aria-labelledby": `card-${id}` },
    el(
      doc,
      "h2",
      { id: `card-${id}` },
      title,
      note ? span(doc, "note desk-muted", note) : undefined,
    ),
    ...body,
  );
}

/** @param {Document} doc @param {Overview} model @param {Spec[]} rows */
function engineCard(doc, model, rows) {
  const { engine } = model;
  const status = go(doc, "engine-line", "@refresh", "", [
    stateDot(doc, engine.up ? "running" : "dead", null, engine.up ? "running" : "not reachable"),
    span(doc, "title", engine.up ? `Docker ${engine.version}` : "Not reachable"),
    engine.platform ? span(doc, "desk-muted", engine.platform) : undefined,
  ]);
  const context = go(doc, "context", "@switchContext", "", [
    span(doc, "label", "Context"),
    span(doc, "value", engine.context || "the CLI's current"),
    span(doc, "hint desk-muted", "c switches"),
  ]);
  rows.push(status, context);
  const problem = engine.problem
    ? el(
        doc,
        "div",
        { class: "desk-error problem-card", role: "alert" },
        el(doc, "p", {}, engine.problem),
        el(
          doc,
          "button",
          { type: "button", class: "desk-btn", "data-act": "refresh" },
          "Try again",
        ),
      )
    : undefined;
  return card(doc, "engine", "Engine", "", [status.el, context.el, problem]);
}

/** The containers by state: each tile opens the containers with only those. */
function containersCard(
  /** @type {Document} */ doc,
  /** @type {Overview} */ model,
  /** @type {Spec[]} */ rows,
) {
  const { counts } = model;
  const tiles = [
    ["running", "Running", counts.running, "is:running"],
    ["unhealthy", "Unhealthy", counts.unhealthy, "is:unhealthy"],
    ["paused", "Paused or restarting", counts.paused + counts.restarting, "is:paused"],
    ["exited", "Stopped", counts.stopped, "is:stopped"],
  ].map(([state, label, n, query]) => {
    const tile = go(
      doc,
      `tile state-${state}${Number(n) === 0 ? " zero" : ""}`,
      "containers",
      String(query),
      [
        stateDot(doc, String(state), null, String(label)),
        span(doc, "number", String(n)),
        span(doc, "label", String(label)),
      ],
    );
    rows.push(tile);
    return tile.el;
  });
  return card(doc, "containers", "Containers", plural(counts.total, "container"), [
    el(doc, "div", { class: "tiles" }, ...tiles),
  ]);
}

/** @param {Document} doc @param {Overview} model @param {Spec[]} rows */
function stacksCard(doc, model, rows) {
  const lines = model.stacks.map((s) => {
    const spec = go(doc, `stack state-${s.state}`, "containers", `project:${s.name}`, [
      stateDot(doc, s.state, null, `${s.name}: ${s.running} of ${s.total} running`),
      span(doc, "name", s.name),
      span(doc, "count desk-muted", `${s.running}/${s.total}`),
      el(
        doc,
        "span",
        { class: "services" },
        ...s.services.map((v) =>
          stateDot(
            doc,
            v.state,
            v.health,
            `${v.name}: ${v.state}${v.health ? `, ${v.health}` : ""}`,
          ),
        ),
      ),
    ]);
    rows.push(spec);
    return spec.el;
  });
  if (model.standalone > 0) {
    const other = go(doc, "stack standalone", "containers", "is:standalone", [
      span(doc, "name", "Not in a stack"),
      span(doc, "count desk-muted", plural(model.standalone, "container")),
    ]);
    rows.push(other);
    lines.push(other.el);
  }
  const none =
    lines.length === 0
      ? el(doc, "p", { class: "desk-muted" }, "No Compose stacks yet.")
      : undefined;
  return card(doc, "stacks", "Compose stacks", String(model.stacks.length || ""), [...lines, none]);
}

/** The running containers using the most CPU, with their sparklines. */
function busiestCard(
  /** @type {Document} */ doc,
  /** @type {Overview} */ model,
  /** @type {StatsRead | undefined} */ read,
  /** @type {Spec[]} */ rows,
) {
  const ranked = model.running
    .map((c) => ({ ...c, snap: read?.(c.id) }))
    .filter((c) => c.snap)
    .sort((a, b) => (b.snap?.latest.cpu ?? 0) - (a.snap?.latest.cpu ?? 0))
    .slice(0, 4);
  const lines = ranked.map((c) => {
    const snap = /** @type {import("./stats.js").Snapshot} */ (c.snap);
    const cpu = cpuText(snap.latest.cpu);
    const spec = /** @type {Spec} */ (
      row(
        doc,
        "go busy",
        { kind: "container", id: c.id, name: c.name, state: "running", project: c.project },
        1,
        [
          span(doc, "name", c.name),
          sparkline(doc, snap.cpu, {
            kind: "cpu",
            label: `CPU ${cpu}`,
            max: 5,
            width: 80,
            height: 18,
            slots: 60,
          }),
          span(doc, "value", cpu),
          span(doc, "value desk-muted", snap.latest.memText.split("/")[0]?.trim() ?? ""),
        ],
        undefined,
        { key: `busy:${c.id}` },
      )
    );
    rows.push(spec);
    return spec.el;
  });
  const note =
    model.running.length === 0
      ? "Nothing is running."
      : "Resource use shows once docker stats reports it.";
  return card(
    doc,
    "busiest",
    "Busiest",
    "",
    lines.length ? lines : [el(doc, "p", { class: "desk-muted" }, note)],
  );
}

/** @param {Document} doc @param {Overview} model @param {Spec[]} rows */
function diskCard(doc, model, rows) {
  if (!model.disk)
    return card(doc, "disk", "Disk use", "", [
      el(doc, "p", { class: "desk-muted" }, "Reading disk use…"),
    ]);
  const lines = model.disk.rows.map((d) => {
    const share = d.bytes > 0 ? Math.round((d.reclaimable / d.bytes) * 100) : 0;
    const meter = el(
      doc,
      "span",
      {
        class: "meter",
        role: "meter",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(share),
        "aria-label": `${share}% of ${d.label} could be reclaimed`,
      },
      el(doc, "span", { class: "fill" }),
    );
    /** @type {HTMLElement} */ (meter.firstChild).style.width = `${share}%`;
    const list =
      d.type === "Images"
        ? "images"
        : d.type === "Local Volumes"
          ? "volumes"
          : d.type === "Containers"
            ? "containers"
            : "@pruneSystem";
    const query = list === "images" ? "is:unused" : list === "containers" ? "is:stopped" : "";
    const spec = go(doc, "disk-line", list, query, [
      span(doc, "label", d.label),
      span(doc, "value", formatBytes(d.bytes)),
      meter,
      span(doc, "desk-muted", `${formatBytes(d.reclaimable)} reclaimable`),
    ]);
    rows.push(spec);
    return spec.el;
  });
  const clean = go(doc, "clean", "@pruneSystem", "", [
    span(doc, "title", "Clean up…"),
    span(doc, "desk-muted", "X: says what goes before anything does"),
  ]);
  rows.push(clean);
  return card(
    doc,
    "disk",
    "Disk use",
    `${formatBytes(model.disk.bytes)} · ${formatBytes(model.disk.reclaimable)} reclaimable`,
    [...lines, clean.el],
  );
}

/** @param {Document} doc @param {Overview} model @param {Spec[]} rows */
function objectsCard(doc, model, rows) {
  const { images, volumes, networks } = model;
  const lines = [
    go(doc, "count-line", "images", "", [
      span(doc, "label", "Images"),
      span(doc, "value", String(images.count)),
      span(doc, "desk-muted", formatBytes(images.bytes)),
    ]),
    go(doc, "count-line", "images", "is:dangling", [
      span(doc, "label", "Dangling"),
      span(doc, "value", String(images.dangling.count)),
      span(doc, "desk-muted", formatBytes(images.dangling.bytes)),
    ]),
    ...images.largest.map((i) =>
      go(doc, "count-line largest", "images", i.ref.split("@")[0] ?? i.ref, [
        span(doc, "label desk-muted", "Largest"),
        el(doc, "span", { class: "value name", title: i.ref }, i.ref),
        span(doc, "desk-muted", formatBytes(i.bytes)),
      ]),
    ),
    go(doc, "count-line", "volumes", "", [
      span(doc, "label", "Volumes"),
      span(doc, "value", String(volumes.count)),
      span(doc, "desk-muted", `${volumes.anonymous} anonymous`),
    ]),
    go(doc, "count-line", "networks", "", [
      span(doc, "label", "Networks"),
      span(doc, "value", String(networks.count)),
      span(doc, "desk-muted", `${networks.custom} of your own`),
    ]),
  ];
  rows.push(...lines);
  return card(
    doc,
    "objects",
    "Images, volumes and networks",
    "",
    lines.map((l) => l.el),
  );
}

/**
 * @param {Document} doc
 * @param {Overview} model
 * @param {StatsRead} [read]
 * @returns {{ rows: Spec[], nodes: Node[] }}
 */
export function renderOverview(doc, model, read) {
  /** @type {Spec[]} */
  const rows = [];
  const cards = [engineCard(doc, model, rows)];
  if (model.engine.up || model.counts.total > 0)
    cards.push(
      containersCard(doc, model, rows),
      stacksCard(doc, model, rows),
      busiestCard(doc, model, read, rows),
      diskCard(doc, model, rows),
      objectsCard(doc, model, rows),
    );
  return { rows, nodes: [el(doc, "div", { class: "cards" }, ...cards)] };
}
