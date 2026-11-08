// Filter, sort and search over the lists (DOCK-19), without the DOM. A query is words and terms:
// `web state:running project:shop -is:stopped port:8080`. Every word must match somewhere (name,
// service, project, image, id, status, ports); every term must hold; a leading `-` negates. Sorting
// is stable and never reorders what it cannot compare.

import { bucketOf, parseSize } from "./overview.js";
import { statsFor } from "./parse-engine.js";
import { portText } from "./parse-list.js";

/**
 * @typedef {import("./parse-list.js").Container} Container
 * @typedef {import("./parse-list.js").Image} Image
 * @typedef {import("./parse-list.js").Volume} Volume
 * @typedef {import("./parse-list.js").Network} Network
 * @typedef {import("./parse-engine.js").Stats} Stats
 * @typedef {{ key: string, value: string, not: boolean }} Term
 * @typedef {{ words: string[], terms: Term[] }} Query
 * @typedef {{ key: string, desc: boolean }} Sort
 * @typedef {{ query: string, sort: Sort }} Prefs
 */

export const CONTAINER_SORTS = /** @type {const} */ ([
  "name",
  "state",
  "cpu",
  "memory",
  "uptime",
  "image",
]);
export const IMAGE_SORTS = /** @type {const} */ (["name", "size", "created", "used"]);
export const NAME_SORTS = /** @type {const} */ (["name"]);

/** The sorts each list offers, the first its default. */
export const SORTS = /** @type {Record<string, readonly string[]>} */ ({
  containers: CONTAINER_SORTS,
  compose: NAME_SORTS,
  images: IMAGE_SORTS,
  volumes: NAME_SORTS,
  networks: NAME_SORTS,
});

/** The state chips over a list: a label and the term it puts in the query. */
export const CHIPS = /** @type {Record<string, Array<{ label: string, term: string }>>} */ ({
  containers: [
    { label: "All", term: "" },
    { label: "Running", term: "is:running" },
    { label: "Unhealthy", term: "is:unhealthy" },
    { label: "Stopped", term: "is:stopped" },
  ],
  images: [
    { label: "All", term: "" },
    { label: "In use", term: "is:used" },
    { label: "Unused", term: "is:unused" },
    { label: "Dangling", term: "is:dangling" },
  ],
  volumes: [
    { label: "All", term: "" },
    { label: "Named", term: "is:named" },
    { label: "Anonymous", term: "is:anonymous" },
  ],
});

/** @param {string} text @returns {Query} */
export function parseQuery(text) {
  /** @type {Query} */
  const query = { words: [], terms: [] };
  for (const raw of text.trim().split(/\s+/)) {
    if (raw === "" || raw === "-") continue;
    const not = raw.startsWith("-") && raw.length > 1;
    const part = not ? raw.slice(1) : raw;
    const colon = part.indexOf(":");
    if (colon > 0 && colon < part.length - 1)
      query.terms.push({
        key: part.slice(0, colon).toLowerCase(),
        value: part.slice(colon + 1).toLowerCase(),
        not,
      });
    else if (!not) query.words.push(part.toLowerCase());
    else query.terms.push({ key: "word", value: part.toLowerCase(), not: true });
  }
  return query;
}

/** The query with a chip's term in place of any other `is:` term. */
export function withChip(/** @type {string} */ text, /** @type {string} */ term) {
  const rest = text
    .split(/\s+/)
    .filter((part) => part !== "" && !/^is:/i.test(part))
    .join(" ");
  return [rest, term].filter(Boolean).join(" ");
}

/** The `is:` term a query holds, so the chip that put it there shows as chosen. */
export const chipOf = (/** @type {string} */ text) =>
  text
    .split(/\s+/)
    .find((part) => /^is:/i.test(part))
    ?.toLowerCase() ?? "";

const has = (/** @type {string} */ hay, /** @type {string} */ value) =>
  hay.toLowerCase().includes(value);

/** Every term and word holds, given a term's own test and the text words search. */
function matches(
  /** @type {Query} */ query,
  /** @type {(term: Term) => boolean | undefined} */ term,
  /** @type {string} */ hay,
) {
  const lower = hay.toLowerCase();
  for (const word of query.words) if (!lower.includes(word)) return false;
  for (const t of query.terms) {
    const held = t.key === "word" ? lower.includes(t.value) : (term(t) ?? lower.includes(t.value));
    if (held === t.not) return false;
  }
  return true;
}

/** What `is:` and `state:` mean for a container: a docker state or one of the overview's buckets. */
function stateIs(/** @type {Container} */ c, /** @type {string} */ value) {
  if (value === "stopped") return bucketOf(c) === "stopped";
  if (value === "unhealthy" || value === "healthy" || value === "starting")
    return c.health === value;
  return c.state === value || bucketOf(c) === value;
}

/** @param {Container} c @param {Query} query */
export function matchContainer(c, query) {
  const ports = c.ports.map(portText).join(" ");
  return matches(
    query,
    (t) => {
      if (t.key === "is" && t.value === "standalone") return c.project === "";
      if (t.key === "is" || t.key === "state") return stateIs(c, t.value);
      if (t.key === "health") return (c.health ?? "none") === t.value;
      if (t.key === "project" || t.key === "stack") return c.project.toLowerCase() === t.value;
      if (t.key === "service") return c.service.toLowerCase() === t.value;
      if (t.key === "image") return has(c.image, t.value);
      if (t.key === "name") return has(c.name, t.value);
      if (t.key === "id") return c.id.startsWith(t.value);
      if (t.key === "port")
        return c.ports.some((p) => p.host === t.value || p.container === t.value);
      return undefined;
    },
    `${c.name} ${c.service} ${c.project} ${c.image} ${c.id.slice(0, 12)} ${c.status} ${ports}`,
  );
}

/** "Up 6 hours (healthy)" as seconds up; -1 when it is not up. */
export function uptimeOf(/** @type {string} */ status) {
  const up = /^Up (.+?)(?: \(.*\))?$/.exec(status)?.[1];
  if (!up) return -1;
  if (/^less than a second/i.test(up)) return 0;
  const found = /^(about an?|an?|\d+) (second|minute|hour|day|week|month|year)s?/i.exec(up);
  if (!found) return 0;
  const n = /^\d+$/.test(found[1] ?? "") ? Number(found[1]) : 1;
  const unit = /** @type {Record<string, number>} */ ({
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86_400,
    week: 604_800,
    month: 2_592_000,
    year: 31_536_000,
  })[(found[2] ?? "").toLowerCase()];
  return n * (unit ?? 0);
}

/** The order of the states when sorting by state: what needs looking at first. */
const STATE_ORDER = ["unhealthy", "restarting", "paused", "running", "stopped"];

/**
 * @template T
 * @param {T[]} list
 * @param {(item: T) => string | number} key
 * @param {boolean} desc
 */
function sortBy(list, key, desc) {
  return list
    .map((item, index) => ({ item, index, key: key(item) }))
    .sort((a, b) => {
      const order =
        typeof a.key === "number" && typeof b.key === "number"
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key));
      return (desc ? -order : order) || a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * @param {Container[]} list
 * @param {string} text The query.
 * @param {Sort} sort
 * @param {Map<string, Stats>} [stats] For the CPU and memory sorts.
 */
export function viewContainers(list, text, sort, stats = new Map()) {
  const query = parseQuery(text);
  const shown = list.filter((c) => matchContainer(c, query));
  const use = (/** @type {Container} */ c) => statsFor(stats, c.id);
  const keys = /** @type {Record<string, (c: Container) => string | number>} */ ({
    name: (c) => c.name,
    state: (c) => STATE_ORDER.indexOf(bucketOf(c)),
    cpu: (c) => use(c)?.cpu ?? -1,
    memory: (c) => parseSize(use(c)?.memText.split(" / ")[0] ?? ""),
    uptime: (c) => uptimeOf(c.status),
    image: (c) => c.image,
  });
  return sortBy(shown, keys[sort.key] ?? keys.name ?? ((c) => c.name), sort.desc);
}

/** @param {Image} i @param {Query} query */
export function matchImage(i, query) {
  return matches(
    query,
    (t) => {
      if (t.key === "is") {
        if (t.value === "dangling") return i.dangling;
        if (t.value === "unused") return i.containers === 0;
        if (t.value === "used") return (i.containers ?? 0) > 0;
        return false;
      }
      if (t.key === "repo" || t.key === "repository") return has(i.repository, t.value);
      if (t.key === "tag") return i.tag.toLowerCase() === t.value;
      if (t.key === "id") return i.id.replace(/^sha256:/, "").startsWith(t.value);
      return undefined;
    },
    `${i.ref} ${i.repository} ${i.tag} ${i.id.replace(/^sha256:/, "").slice(0, 12)}`,
  );
}

/** @param {Image[]} list @param {string} text @param {Sort} sort */
export function viewImages(list, text, sort) {
  const query = parseQuery(text);
  const keys = /** @type {Record<string, (i: Image) => string | number>} */ ({
    name: (i) => `${i.dangling ? 1 : 0}${i.ref}`,
    size: (i) => parseSize(i.size),
    created: (i) => i.created,
    used: (i) => i.containers ?? -1,
  });
  return sortBy(
    list.filter((i) => matchImage(i, query)),
    keys[sort.key] ?? ((i) => i.ref),
    sort.desc,
  );
}

/** @param {Volume[]} list @param {string} text @param {Sort} sort */
export function viewVolumes(list, text, sort) {
  const query = parseQuery(text);
  const shown = list.filter((v) =>
    matches(
      query,
      (t) => {
        if (t.key === "is") return t.value === "anonymous" ? v.anonymous : !v.anonymous;
        if (t.key === "project" || t.key === "stack") return v.project.toLowerCase() === t.value;
        if (t.key === "driver") return v.driver.toLowerCase() === t.value;
        return undefined;
      },
      `${v.name} ${v.driver} ${v.project}`,
    ),
  );
  return sortBy(shown, (v) => `${v.anonymous ? 1 : 0}${v.name}`, sort.desc);
}

/** @param {Network[]} list @param {string} text @param {Sort} sort */
export function viewNetworks(list, text, sort) {
  const query = parseQuery(text);
  const shown = list.filter((n) =>
    matches(
      query,
      (t) => {
        if (t.key === "is")
          return t.value === "builtin" ? n.builtin : t.value === "internal" && n.internal;
        if (t.key === "project" || t.key === "stack") return n.project.toLowerCase() === t.value;
        if (t.key === "driver") return n.driver.toLowerCase() === t.value;
        return undefined;
      },
      `${n.name} ${n.driver} ${n.scope} ${n.project}`,
    ),
  );
  return sortBy(shown, (n) => `${n.builtin ? 0 : 1}${n.name}`, sort.desc);
}

/** The sort after `key` in a list's sorts, back to the first after the last. */
export function nextSort(/** @type {string} */ list, /** @type {Sort} */ sort) {
  const keys = SORTS[list] ?? NAME_SORTS;
  const at = keys.indexOf(sort.key);
  return { key: keys[(at + 1) % keys.length] ?? "name", desc: false };
}
