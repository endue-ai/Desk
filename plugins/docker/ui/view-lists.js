// The rows of each list: containers grouped by Compose project, Compose projects with their
// services, images, volumes, networks, and the engine with its contexts and disk use. Each renderer
// returns row specs (element, item, depth, fold key); view.js adds the tree roles and the cursor.

import { el, row, span } from "./dom.js";
import { statsFor } from "./parse-engine.js";
import { portText } from "./parse-list.js";

/**
 * @typedef {import("./dom.js").RowSpec} RowSpec
 * @typedef {import("./parse-list.js").Container} Container
 * @typedef {import("./lists.js").ContainersModel} ContainersModel
 * @typedef {import("./lists.js").ComposeModel} ComposeModel
 * @typedef {import("./lists.js").ImagesModel} ImagesModel
 * @typedef {import("./lists.js").VolumesModel} VolumesModel
 * @typedef {import("./lists.js").NetworksModel} NetworksModel
 * @typedef {import("./lists.js").SystemModel} SystemModel
 */

const caret = (/** @type {Document} */ doc, /** @type {boolean} */ open) =>
  span(doc, "caret", open ? "▾" : "▸");

/** A section heading row that folds the rows under it. */
function heading(
  /** @type {Document} */ doc,
  /** @type {string} */ key,
  /** @type {string} */ title,
  /** @type {Set<string>} */ folded,
  /** @type {string} */ count = "",
) {
  return row(
    doc,
    "section",
    { kind: "section", section: key },
    1,
    [
      caret(doc, !folded.has(key)),
      span(doc, "title", title),
      count ? span(doc, "count", count) : undefined,
    ],
    key,
  );
}

const empty = (/** @type {Document} */ doc, /** @type {string} */ text) =>
  row(doc, "empty", undefined, 1, [span(doc, "muted", text)]);

/** The state as a coloured dot with a word for screen readers. */
function stateDot(/** @type {Document} */ doc, /** @type {Container} */ c) {
  const health = c.health && c.state === "running" ? ` ${c.health}` : "";
  return el(doc, "span", {
    class: `dot state-${c.state}${c.health ? ` health-${c.health}` : ""}`,
    role: "img",
    "aria-label": `${c.state}${health}`,
  });
}

/** One container row; `stats` adds CPU and memory when sampled. */
function containerRow(
  /** @type {Document} */ doc,
  /** @type {Container} */ c,
  /** @type {number} */ level,
  /** @type {ContainersModel["stats"] | undefined} */ stats,
) {
  const use = stats ? statsFor(stats, c.id) : undefined;
  const ports = c.ports
    .filter((p) => p.host !== "")
    .map(portText)
    .join(" ");
  return row(
    doc,
    `container state-${c.state}`,
    { kind: "container", id: c.id, name: c.name, state: c.state, project: c.project },
    level,
    [
      stateDot(doc, c),
      span(doc, "name", c.service && level > 1 ? c.service : c.name),
      span(doc, "image muted", c.image),
      span(doc, "status", c.status),
      ports ? span(doc, "ports", ports) : undefined,
      use
        ? span(doc, "use muted", `${use.cpuText} · ${use.memText.split(" / ")[0] ?? ""}`)
        : undefined,
    ],
  );
}

/**
 * Containers: one section per Compose project, then the ones Compose did not start.
 * @param {Document} doc
 * @param {ContainersModel} model
 * @param {Set<string>} folded
 * @returns {RowSpec[]}
 */
export function renderContainers(doc, model, folded) {
  if (model.containers.length === 0)
    return [
      empty(
        doc,
        model.all
          ? "No containers. Run one from an image (3, then R)."
          : "No running containers. a shows stopped ones too.",
      ),
    ];
  /** @type {Map<string, Container[]>} */
  const groups = new Map();
  for (const c of model.containers) {
    const key = c.project;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  /** @type {RowSpec[]} */
  const rows = [];
  for (const key of keys) {
    const list = groups.get(key) ?? [];
    const fold = key ? `project:${key}` : "standalone";
    const running = list.filter((c) => c.state === "running").length;
    rows.push(heading(doc, fold, key || "Containers", folded, `${running}/${list.length}`));
    if (folded.has(fold)) continue;
    for (const c of list.sort((a, b) => a.name.localeCompare(b.name)))
      rows.push(containerRow(doc, c, 2, model.stats));
  }
  return rows;
}

/**
 * Compose projects, each with its services' containers under it.
 * @param {Document} doc
 * @param {ComposeModel} model
 * @param {Set<string>} folded
 * @returns {RowSpec[]}
 */
export function renderCompose(doc, model, folded) {
  if (model.projects.length === 0)
    return [empty(doc, "No Compose projects. Up one with Docker: Compose up and a file.")];
  /** @type {RowSpec[]} */
  const rows = [];
  for (const p of [...model.projects].sort((a, b) => a.name.localeCompare(b.name))) {
    const fold = `compose:${p.name}`;
    const state = p.running === 0 ? "exited" : p.running < p.total ? "partial" : "running";
    rows.push(
      row(
        doc,
        `project state-${state}`,
        { kind: "project", name: p.name, files: p.files },
        1,
        [
          caret(doc, !folded.has(fold)),
          el(doc, "span", { class: `dot state-${state}`, role: "img", "aria-label": p.status }),
          span(doc, "name", p.name),
          span(doc, "status", p.status),
          span(doc, "files muted", p.files.join(", ")),
        ],
        fold,
      ),
    );
    if (folded.has(fold)) continue;
    const services = model.containers.filter((c) => c.project === p.name);
    for (const c of services.sort((a, b) => a.service.localeCompare(b.service)))
      rows.push(containerRow(doc, c, 2, undefined));
  }
  return rows;
}

/** A digest reference as it fits a row: `repo@sha256:4f53cda18c2b…`; the item keeps the whole. */
const shortDigest = (/** @type {string} */ ref) =>
  ref.replace(/@(sha256:[0-9a-f]{12})[0-9a-f]+$/, "@$1…");

/** @param {Document} doc @param {ImagesModel} model @returns {RowSpec[]} */
export function renderImages(doc, model) {
  if (model.images.length === 0) return [empty(doc, "No images. U pulls one.")];
  return [...model.images]
    .sort((a, b) => Number(a.dangling) - Number(b.dangling) || a.ref.localeCompare(b.ref))
    .map((image) => {
      const used =
        image.containers === null
          ? ""
          : image.containers === 0
            ? "unused"
            : `${image.containers} container${image.containers === 1 ? "" : "s"}`;
      return row(
        doc,
        `image${image.dangling ? " dangling" : ""}`,
        {
          kind: "image",
          id: image.id,
          ref: image.ref,
          dangling: image.dangling,
          containers: image.containers,
        },
        1,
        [
          span(doc, "name", image.dangling ? "<none>" : shortDigest(image.ref)),
          span(doc, "id muted", image.id.replace(/^sha256:/, "").slice(0, 12)),
          span(doc, "size", image.size),
          span(doc, "created muted", image.created),
          used ? span(doc, "used muted", used) : undefined,
        ],
      );
    });
}

/** @param {Document} doc @param {VolumesModel} model @returns {RowSpec[]} */
export function renderVolumes(doc, model) {
  if (model.volumes.length === 0) return [empty(doc, "No volumes.")];
  return [...model.volumes]
    .sort((a, b) => Number(a.anonymous) - Number(b.anonymous) || a.name.localeCompare(b.name))
    .map((v) =>
      row(doc, `volume${v.anonymous ? " anonymous" : ""}`, { kind: "volume", name: v.name }, 1, [
        span(doc, "name", v.anonymous ? `${v.name.slice(0, 12)}…` : v.name),
        span(doc, "driver muted", v.driver),
        v.anonymous ? span(doc, "tag", "anonymous") : undefined,
        v.project ? span(doc, "project muted", v.project) : undefined,
      ]),
    );
}

/** @param {Document} doc @param {NetworksModel} model @returns {RowSpec[]} */
export function renderNetworks(doc, model) {
  return [...model.networks]
    .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name))
    .map((n) =>
      row(
        doc,
        `network${n.builtin ? " builtin" : ""}`,
        { kind: "network", id: n.id, name: n.name, builtin: n.builtin },
        1,
        [
          span(doc, "name", n.name),
          span(doc, "driver muted", n.driver),
          span(doc, "scope muted", n.scope),
          n.internal ? span(doc, "tag", "internal") : undefined,
          n.builtin ? span(doc, "tag", "built in") : undefined,
          n.project ? span(doc, "project muted", n.project) : undefined,
        ],
      ),
    );
}

/** A label and a value, as the engine and detail sections show them. */
export const field = (
  /** @type {Document} */ doc,
  /** @type {string} */ section,
  /** @type {string} */ label,
  /** @type {string} */ value,
  /** @type {string} */ classes = "",
) =>
  row(doc, `field ${classes}`.trim(), { kind: "field", section, label }, 2, [
    span(doc, "label", label),
    span(doc, "value", value),
  ]);

/**
 * The engine, the contexts and disk use.
 * @param {Document} doc
 * @param {SystemModel} model
 * @param {Set<string>} folded
 * @returns {RowSpec[]}
 */
export function renderSystem(doc, model, folded) {
  const { client, server } = model.version;
  /** @type {Array<[string, string, Array<[string, string, string?]>]>} */
  const sections = [
    [
      "engine",
      "Engine",
      [
        ["Server", server ? `${server.version} (API ${server.api})` : "not reachable"],
        ["Platform", server?.platform ?? ""],
        ["System", server ? `${server.os}/${server.arch}` : ""],
        [
          "Client",
          client ? `${client.version} (API ${client.api}) ${client.os}/${client.arch}` : "",
        ],
      ],
    ],
    [
      "contexts",
      "Contexts",
      model.contexts.map((c) => [
        c.name === (model.context || client?.context) ? `${c.name} (in use)` : c.name,
        [c.endpoint, c.error].filter(Boolean).join(" · ") || c.description,
        c.error ? "error" : "",
      ]),
    ],
    [
      "disk",
      "Disk use",
      model.disk.map((d) => [
        d.type,
        `${d.size} in ${d.total} (${d.active} active), ${d.reclaimable} reclaimable`,
      ]),
    ],
  ];
  /** @type {RowSpec[]} */
  const rows = [];
  for (const [key, title, pairs] of sections) {
    const shown = pairs.filter(([, value]) => value !== "");
    if (shown.length === 0) continue;
    rows.push(heading(doc, key, title, folded));
    if (folded.has(key)) continue;
    for (const [label, value, classes] of shown)
      rows.push(field(doc, key, label, value, classes ?? ""));
  }
  return rows;
}

/**
 * A container's detail: its sections, each folding.
 * @param {Document} doc
 * @param {import("./inspect.js").Detail} model
 * @param {Set<string>} folded
 * @returns {RowSpec[]}
 */
export function renderDetail(doc, model, folded) {
  /** @type {RowSpec[]} */
  const rows = [];
  for (const section of model.sections) {
    const key = `detail:${section.id}`;
    rows.push(heading(doc, key, section.title, folded, String(section.fields.length)));
    if (folded.has(key)) continue;
    for (const f of section.fields)
      rows.push(field(doc, section.id, f.label, f.value, f.masked ? "masked" : ""));
  }
  return rows;
}
