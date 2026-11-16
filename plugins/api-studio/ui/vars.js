// {{variables}}: where a name's value comes from and what a text reads once they are filled in.
// Scopes are looked up from the narrowest to the broadest: values set while running (scripts and
// response captures), the request's own, its folders' (innermost first), the active environment,
// the collection's, then the globals. `{{$name}}` makes a fresh value each time (an id, a time, a
// random number or word); a name nobody defines stays as typed, so the miss is visible.

/** @typedef {{ name: string, label: string, values: Map<string, string>, secret?: Set<string> }} Scope */

const PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

const WORDS = [
  "amber",
  "birch",
  "cobalt",
  "delta",
  "ember",
  "fjord",
  "garnet",
  "harbor",
  "indigo",
  "juniper",
  "kelp",
  "lumen",
  "maple",
  "nova",
  "orbit",
  "pebble",
  "quartz",
  "river",
  "sable",
  "tide",
];
const FIRST = [
  "Ada",
  "Bo",
  "Chen",
  "Dara",
  "Eli",
  "Femi",
  "Gus",
  "Hana",
  "Ivo",
  "Jun",
  "Kai",
  "Lea",
  "Mina",
  "Noor",
  "Oli",
  "Pia",
  "Rui",
  "Sami",
  "Tae",
  "Uma",
];
const LAST = [
  "Park",
  "Okafor",
  "Silva",
  "Novak",
  "Haddad",
  "Kim",
  "Moreau",
  "Rossi",
  "Tanaka",
  "Weber",
  "Yilmaz",
  "Larsen",
];

const pick = (/** @type {string[]} */ list) => list[Math.floor(Math.random() * list.length)] ?? "";
const int = (/** @type {number} */ min, /** @type {number} */ max) =>
  Math.floor(min + Math.random() * (max - min + 1));

/** A version 4 UUID from the platform's random source. */
export function uuid() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = int(0, 255);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The values that are made fresh on each use, with what each gives. */
export const DYNAMIC = /** @type {Record<string, { desc: string, make(): string }>} */ ({
  $uuid: { desc: "A random UUID v4", make: uuid },
  $guid: { desc: "A random UUID v4", make: uuid },
  $timestamp: {
    desc: "Seconds since 1970, now",
    make: () => String(Math.floor(Date.now() / 1000)),
  },
  $timestampMs: { desc: "Milliseconds since 1970, now", make: () => String(Date.now()) },
  $isoTimestamp: { desc: "Now as an ISO 8601 time", make: () => new Date().toISOString() },
  $date: { desc: "Today as YYYY-MM-DD", make: () => new Date().toISOString().slice(0, 10) },
  $randomInt: { desc: "A whole number from 0 to 1000", make: () => String(int(0, 1000)) },
  $randomFloat: { desc: "A number from 0 to 1", make: () => Math.random().toFixed(6) },
  $randomBoolean: { desc: "true or false", make: () => String(Math.random() < 0.5) },
  $randomWord: { desc: "A random word", make: () => pick(WORDS) },
  $randomFirstName: { desc: "A first name", make: () => pick(FIRST) },
  $randomLastName: { desc: "A last name", make: () => pick(LAST) },
  $randomFullName: { desc: "A full name", make: () => `${pick(FIRST)} ${pick(LAST)}` },
  $randomEmail: {
    desc: "An e-mail address at example.com",
    make: () => `${pick(FIRST).toLowerCase()}.${pick(WORDS)}${int(1, 99)}@example.com`,
  },
  $randomUserName: {
    desc: "A user name",
    make: () => `${pick(WORDS)}_${pick(WORDS)}${int(1, 999)}`,
  },
  $randomPhone: {
    desc: "A phone number",
    make: () => `+1-555-${String(int(100, 999))}-${String(int(1000, 9999))}`,
  },
  $randomColor: {
    desc: "A colour name",
    make: () => pick(["red", "green", "blue", "teal", "amber", "violet"]),
  },
  $randomHex: {
    desc: "Eight hex digits",
    make: () => int(0, 0xffffffff).toString(16).padStart(8, "0"),
  },
  $randomIp: {
    desc: "An IPv4 address",
    make: () => `${int(1, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
  },
  $randomUrl: {
    desc: "An https URL",
    make: () => `https://${pick(WORDS)}.example.com/${pick(WORDS)}`,
  },
  $randomCity: {
    desc: "A city",
    make: () => pick(["Seoul", "Lisbon", "Oslo", "Nairobi", "Lima", "Osaka", "Tallinn"]),
  },
  $randomLoremSentence: {
    desc: "A short sentence",
    make: () =>
      `${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}.`.replace(/^./, (c) =>
        c.toUpperCase(),
      ),
  },
});

/** A scope from pairs (enabled ones with a name) or a plain object. @param {string} name @param {string} label @param {any} source */
export function scope(name, label, source, secret = new Set()) {
  /** @type {Map<string, string>} */
  const values = new Map();
  if (Array.isArray(source)) {
    for (const p of source)
      if (p?.on !== false && p?.key) values.set(String(p.key), String(p.value ?? ""));
  } else if (source && typeof source === "object")
    for (const [k, v] of Object.entries(source)) values.set(k, String(v ?? ""));
  return { name, label, values, secret };
}

/**
 * Where a name is defined: the narrowest scope that has it, its value and whether it is secret.
 * @param {Scope[]} scopes @param {string} name
 */
export function lookup(scopes, name) {
  if (name in DYNAMIC)
    return { scope: "dynamic", label: "Dynamic", value: undefined, dynamic: true, secret: false };
  for (const s of scopes)
    if (s.values.has(name))
      return {
        scope: s.name,
        label: s.label,
        value: s.values.get(name) ?? "",
        dynamic: false,
        secret: s.secret?.has(name) ?? false,
      };
  return undefined;
}

/**
 * The text with every {{name}} filled in, values that hold variables filled in too (at most eight
 * levels deep, so a loop stops). `missing` collects the names nobody defines.
 * @param {string} text @param {Scope[]} scopes @param {Set<string>} [missing]
 */
export function resolve(text, scopes, missing) {
  if (!text?.includes("{{")) return text;
  let out = text;
  for (let depth = 0; depth < 8 && out.includes("{{"); depth++) {
    let changed = false;
    out = out.replace(PATTERN, (whole, name) => {
      const dyn = DYNAMIC[name];
      if (dyn) {
        changed = true;
        return dyn.make();
      }
      const found = lookup(scopes, name);
      if (!found || found.value === undefined) {
        missing?.add(name);
        return whole;
      }
      changed = true;
      return found.value;
    });
    if (!changed) break;
  }
  return out;
}

/**
 * The text cut into plain runs and variable references, for drawing: each reference knows whether
 * it is defined, dynamic or missing.
 * @param {string} text @param {Scope[]} scopes
 * @returns {({ text: string } | { name: string, raw: string, state: "set" | "dynamic" | "missing" })[]}
 */
export function tokens(text, scopes) {
  /** @type {({ text: string } | { name: string, raw: string, state: "set" | "dynamic" | "missing" })[]} */
  const out = [];
  let at = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    const name = match[1] ?? "";
    const found = lookup(scopes, name);
    out.push({
      name,
      raw: match[0],
      state: found ? (found.dynamic ? "dynamic" : "set") : "missing",
    });
    at = start + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Every variable name a text refers to. @param {string} text */
export function namesIn(text) {
  return [...String(text).matchAll(PATTERN)].map((m) => m[1] ?? "");
}
