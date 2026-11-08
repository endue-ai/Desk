// The rows of each list, filtered and sorted by its query (query.js): containers grouped by
// Compose project with live resource use, Compose projects with their services, images with their
// size against the largest, volumes and networks. Each renderer returns the row specs (tree.js) and
// the nodes to draw, a column header first; the metric cells are patched in place as stats come.

import { caret, el, empty, heading, row, span, stateDot } from "./dom.js";
import { parseSize } from "./overview.js";
import { portText } from "./parse-list.js";
import { portUrl } from "./ports.js";
import { viewContainers, viewImages, viewNetworks, viewVolumes } from "./query.js";

/**
 * @typedef {import("./tree.js").RowSpec & { metrics?: Metrics }} Spec
 * @typedef {{ id: string, cpu: HTMLElement, mem: HTMLElement, net: HTMLElement }} Metrics
 * @typedef {import("./parse-list.js").Container} Container
 * @typedef {import("./query.js").Prefs} Prefs
 * @typedef {{ rows: Spec[], nodes: Node[] }} Drawn
 */

const COLUMNS = /** @type {Record<string, Array<[string, string]>>} */ ({
  containers: [
    ["", ""],
    ["name", "Name"],
    ["image", "Image"],
    ["", "Ports"],
    ["cpu", "CPU"],
    ["memory", "Memory"],
    ["", "Network"],
    ["uptime", "Status"],
  ],
  images: [
    ["name", "Image"],
    ["", "Id"],
    ["size", "Size"],
    ["created", "Created"],
    ["used", "Used by"],
  ],
});

/** The column header: a sort button on each column that sorts, the sorted one showing its way. */
function header(
  /** @type {Document} */ doc,
  /** @type {string} */ list,
  /** @type {Prefs} */ prefs,
) {
  const columns = COLUMNS[list];
  if (!columns) return undefined;
  return el(
    doc,
    "div",
    { class: `row head ${list}`, role: "presentation" },
    ...columns.map(([key, label]) => {
      if (key === "") return el(doc, "span", { class: "col" }, label);
      const on = prefs.sort.key === key;
      return el(
        doc,
        "button",
        {
          type: "button",
          class: `desk-btn desk-btn-quiet col sort${on ? " is-sorted" : ""}`,
          "data-sort": key,
          "aria-pressed": on ? "true" : "false",
          title: `Sort by ${label.toLowerCase()}`,
        },
        `${label}${on ? (prefs.sort.desc ? " ↓" : " ↑") : ""}`,
      );
    }),
  );
}

/** The ports a container publishes, each a link when it opens in the browser. */
function ports(/** @type {Document} */ doc, /** @type {Container} */ c) {
  const shown = c.ports.filter((p) => p.host !== "");
  return el(
    doc,
    "span",
    { class: "ports" },
    ...shown.map((p) => {
      const url = portUrl(p);
      return url
        ? el(
            doc,
            "a",
            {
              class: "port",
              href: url,
              "data-container": c.id,
              "data-port": p.host,
              title: `Open ${url}`,
              tabindex: "-1",
            },
            portText(p),
          )
        : span(doc, "port muted", portText(p));
    }),
  );
}

/** A metric cell: a sparkline and its value, filled by the stats stream. */
const metric = (/** @type {Document} */ doc, /** @type {string} */ kind) =>
  el(doc, "span", { class: `metric ${kind}` });

/** One container row with its metric cells; inside a stack it goes by its service. */
function containerRow(
  /** @type {Document} */ doc,
  /** @type {Container} */ c,
  /** @type {number} */ level,
) {
  const cells = {
    id: c.id,
    cpu: metric(doc, "cpu"),
    mem: metric(doc, "mem"),
    net: metric(doc, "net"),
  };
  const running = c.state === "running";
  const spec = row(
    doc,
    `container state-${c.state}`,
    { kind: "container", id: c.id, name: c.name, state: c.state, project: c.project },
    level,
    [
      stateDot(doc, c.state, c.health),
      el(
        doc,
        "span",
        { class: "name", title: c.name },
        c.service && level > 1 ? c.service : c.name,
      ),
      el(doc, "span", { class: "image muted", title: c.image }, c.image),
      ports(doc, c),
      running ? cells.cpu : span(doc, "metric none", ""),
      running ? cells.mem : span(doc, "metric none", ""),
      running ? cells.net : span(doc, "metric none", ""),
      el(doc, "span", { class: "status", title: c.status }, c.status),
    ],
    undefined,
    { key: `container:${c.id}`, markable: true },
  );
  return /** @type {Spec} */ ({ ...spec, ...(running ? { metrics: cells } : {}) });
}

/** @param {Document} doc @param {Prefs} prefs @param {Spec[]} rows */
const drawn = (doc, list, prefs, rows) => {
  const head = header(doc, list, prefs);
  return { rows, nodes: [...(head ? [head] : []), ...rows.map((r) => r.el)] };
};

const noMatch = (/** @type {Document} */ doc, /** @type {Prefs} */ prefs) =>
  empty(doc, `Nothing matches “${prefs.query.trim()}”. Esc clears the search.`);

/**
 * Containers: one section per Compose project, then the ones Compose did not start.
 * @param {Document} doc
 * @param {import("./lists.js").ContainersModel} model
 * @param {Prefs} prefs
 * @param {Set<string>} folded
 * @param {Map<string, import("./parse-engine.js").Stats>} [stats]
 * @returns {Drawn}
 */
export function renderContainers(doc, model, prefs, folded, stats) {
  if (model.containers.length === 0)
    return drawn(doc, "containers", prefs, [
      empty(
        doc,
        model.all
          ? "No containers yet. Run one from an image: 4, then R."
          : "No running containers. a shows the stopped ones too.",
      ),
    ]);
  const shown = viewContainers(model.containers, prefs.query, prefs.sort, stats);
  if (shown.length === 0) return drawn(doc, "containers", prefs, [noMatch(doc, prefs)]);
  /** @type {Map<string, Container[]>} */
  const groups = new Map();
  for (const c of shown) groups.set(c.project, [...(groups.get(c.project) ?? []), c]);
  const keys = [...groups.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  /** @type {Spec[]} */
  const rows = [];
  for (const key of keys) {
    const list = groups.get(key) ?? [];
    const fold = key ? `project:${key}` : "standalone";
    const running = list.filter((c) => c.state === "running").length;
    rows.push(
      heading(
        doc,
        fold,
        key || "Other containers",
        folded,
        `${running}/${list.length}`,
        list.map((c) => `container:${c.id}`),
      ),
    );
    if (folded.has(fold)) continue;
    for (const c of list) rows.push(containerRow(doc, c, 2));
  }
  return drawn(doc, "containers", prefs, rows);
}

/**
 * Compose projects, each with its services' containers under it.
 * @param {Document} doc
 * @param {import("./lists.js").ComposeModel} model
 * @param {Prefs} prefs
 * @param {Set<string>} folded
 * @returns {Drawn}
 */
export function renderCompose(doc, model, prefs, folded) {
  if (model.projects.length === 0)
    return drawn(doc, "compose", prefs, [
      empty(doc, "No Compose projects. Docker: Compose up with a compose file starts one."),
    ]);
  const words = prefs.query.trim().toLowerCase();
  const projects = [...model.projects]
    .filter((p) => words === "" || `${p.name} ${p.files.join(" ")}`.toLowerCase().includes(words))
    .sort((a, b) => (prefs.sort.desc ? -1 : 1) * a.name.localeCompare(b.name));
  if (projects.length === 0) return drawn(doc, "compose", prefs, [noMatch(doc, prefs)]);
  /** @type {Spec[]} */
  const rows = [];
  for (const p of projects) {
    const fold = `compose:${p.name}`;
    const state = p.running === 0 ? "exited" : p.running < p.total ? "partial" : "running";
    const services = model.containers.filter((c) => c.project === p.name);
    rows.push(
      row(
        doc,
        `project state-${state}`,
        { kind: "project", name: p.name, files: p.files },
        1,
        [
          caret(doc, !folded.has(fold)),
          stateDot(doc, state, null, p.status),
          span(doc, "name", p.name),
          span(doc, "status", p.status),
          el(doc, "span", { class: "files muted", title: p.files.join("\n") }, p.files.join(", ")),
        ],
        fold,
        { key: fold, group: services.map((c) => `container:${c.id}`) },
      ),
    );
    if (folded.has(fold)) continue;
    for (const c of services.sort((a, b) => a.service.localeCompare(b.service)))
      rows.push(containerRow(doc, c, 2));
  }
  return drawn(doc, "compose", prefs, rows);
}

/** A digest reference as it fits a row: `repo@sha256:4f53cda18c2b…`; the item keeps the whole. */
const shortDigest = (/** @type {string} */ ref) =>
  ref.replace(/@(sha256:[0-9a-f]{12})[0-9a-f]+$/, "@$1…");

/** @param {Document} doc @param {import("./lists.js").ImagesModel} model @param {Prefs} prefs @returns {Drawn} */
export function renderImages(doc, model, prefs) {
  if (model.images.length === 0)
    return drawn(doc, "images", prefs, [
      empty(doc, "No images. U pulls one, B builds one from a Dockerfile."),
    ]);
  const shown = viewImages(model.images, prefs.query, prefs.sort);
  if (shown.length === 0) return drawn(doc, "images", prefs, [noMatch(doc, prefs)]);
  const largest = Math.max(1, ...model.images.map((i) => parseSize(i.size)));
  return drawn(
    doc,
    "images",
    prefs,
    shown.map((image) => {
      const used =
        image.containers === null
          ? ""
          : image.containers === 0
            ? "unused"
            : `${image.containers} container${image.containers === 1 ? "" : "s"}`;
      const share = Math.max(2, Math.round((parseSize(image.size) / largest) * 100));
      const bar = el(
        doc,
        "span",
        { class: "bar", "aria-hidden": "true" },
        el(doc, "span", { class: "fill" }),
      );
      /** @type {HTMLElement} */ (bar.firstChild).style.width = `${share}%`;
      const item = /** @type {const} */ ({
        kind: "image",
        id: image.id,
        ref: image.ref,
        dangling: image.dangling,
        containers: image.containers,
      });
      return row(
        doc,
        `image${image.dangling ? " dangling" : ""}`,
        item,
        1,
        [
          el(
            doc,
            "span",
            { class: "name", title: image.ref },
            image.dangling ? "<none>" : shortDigest(image.ref),
          ),
          span(doc, "id muted", image.id.replace(/^sha256:/, "").slice(0, 12)),
          el(doc, "span", { class: "size" }, bar, span(doc, "value", image.size)),
          span(doc, "created muted", image.created.replace(/ [+-]\d{4} \w+$/, "")),
          span(doc, `used${image.containers === 0 ? " muted" : ""}`, used),
        ],
        undefined,
        { key: `image:${image.id}:${image.ref}`, markable: true },
      );
    }),
  );
}

/** @param {Document} doc @param {import("./lists.js").VolumesModel} model @param {Prefs} prefs @returns {Drawn} */
export function renderVolumes(doc, model, prefs) {
  if (model.volumes.length === 0)
    return drawn(doc, "volumes", prefs, [
      empty(doc, "No volumes. Containers make them when they mount one."),
    ]);
  const shown = viewVolumes(model.volumes, prefs.query, prefs.sort);
  if (shown.length === 0) return drawn(doc, "volumes", prefs, [noMatch(doc, prefs)]);
  return drawn(
    doc,
    "volumes",
    prefs,
    shown.map((v) =>
      row(
        doc,
        `volume${v.anonymous ? " anonymous" : ""}`,
        { kind: "volume", name: v.name },
        1,
        [
          el(
            doc,
            "span",
            { class: "name", title: v.name },
            v.anonymous ? `${v.name.slice(0, 12)}…` : v.name,
          ),
          span(doc, "driver muted", v.driver),
          v.anonymous ? span(doc, "desk-badge", "anonymous") : undefined,
          v.project ? span(doc, "project muted", v.project) : undefined,
        ],
        undefined,
        { key: `volume:${v.name}`, markable: true },
      ),
    ),
  );
}

/** @param {Document} doc @param {import("./lists.js").NetworksModel} model @param {Prefs} prefs @returns {Drawn} */
export function renderNetworks(doc, model, prefs) {
  const shown = viewNetworks(model.networks, prefs.query, prefs.sort);
  if (shown.length === 0) return drawn(doc, "networks", prefs, [noMatch(doc, prefs)]);
  return drawn(
    doc,
    "networks",
    prefs,
    shown.map((n) =>
      row(
        doc,
        `network${n.builtin ? " builtin" : ""}`,
        { kind: "network", id: n.id, name: n.name, builtin: n.builtin },
        1,
        [
          span(doc, "name", n.name),
          span(doc, "driver muted", n.driver),
          span(doc, "scope muted", n.scope),
          n.internal ? span(doc, "desk-badge", "internal") : undefined,
          n.builtin ? span(doc, "desk-badge", "built in") : undefined,
          n.project ? span(doc, "project muted", n.project) : undefined,
        ],
        undefined,
        { key: `network:${n.id}`, markable: !n.builtin },
      ),
    ),
  );
}
