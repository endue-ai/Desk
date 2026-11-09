// The computers the person keeps: a name, a host, a port (5900, Screen Sharing's, by default) and an
// optional user name. Never a password: the other Mac asks for it each time. Kept in the core's store
// for this plugin (64 KiB). No DOM.

/**
 * @typedef {{ id: string, name: string, host: string, port: number, username?: string }} Computer
 * @typedef {{ call(method: string, params: unknown): Promise<any> }} Bridge
 */

export const STORE_KEY = "computers";
export const DEFAULT_PORT = 5900;
const STORE_LIMIT = 64 * 1024;
/** A host name or an IPv4 address, as net.connect takes it. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * What the person typed as an address: `studio.local`, `studio.local:5901`, `vnc://ada@studio.local`
 * (as Finder's Connect to Server takes it), with the port and the user name apart when given.
 * @param {string} text
 * @returns {{ host: string, port?: number, username?: string }}
 */
export function parseAddress(text) {
  const trimmed = text
    .trim()
    .replace(/^vnc:\/\//i, "")
    .replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("@");
  const rest = at >= 0 ? trimmed.slice(at + 1) : trimmed;
  const match = /^(.*?)(?::(\d+))?$/.exec(rest);
  const host = (match?.[1] ?? "").toLowerCase();
  if (!HOST.test(host) || host.length > 253)
    throw new Error(`"${text.trim()}" is not a host name.`);
  const port = match?.[2] === undefined ? undefined : Number(match[2]);
  if (port !== undefined && (port < 1 || port > 65535)) throw new Error(`${port} is not a port.`);
  const username = at > 0 ? decodeURIComponent(trimmed.slice(0, at)) : "";
  return { host, ...(port === undefined ? {} : { port }), ...(username ? { username } : {}) };
}

/**
 * A computer from what a form or a command gave, checked: the address parsed, the port in range,
 * the name the host's when none is given.
 * @param {{ id?: string, name?: string, host?: string, port?: number | string, username?: string }} raw
 * @param {() => string} [makeId]
 * @returns {Computer}
 */
export function normalize(raw, makeId = newId) {
  const address = parseAddress(String(raw.host ?? ""));
  const given = raw.port === undefined || raw.port === "" ? undefined : Number(raw.port);
  const port = given ?? address.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${raw.port} is not a port.`);
  const name = String(raw.name ?? "").trim() || address.host;
  const username = String(raw.username ?? "").trim() || address.username || "";
  return {
    id: raw.id || makeId(),
    name: name.slice(0, 80),
    host: address.host,
    port,
    ...(username ? { username: username.slice(0, 120) } : {}),
  };
}

/** A new computer's id. @param {() => number} [random] */
export function newId(random = Math.random) {
  let out = "";
  while (out.length < 10) out += Math.floor(random() * 36).toString(36);
  return `m-${out.slice(0, 10)}`;
}

/** How a computer reads in a list: its name, and its address when that says more. @param {Computer} c */
export function addressOf(c) {
  return c.port === DEFAULT_PORT ? c.host : `${c.host}:${c.port}`;
}

/** The kept computers; entries that no longer pass the checks are left out. @param {Bridge} bridge */
export async function loadComputers(bridge) {
  const kept = await bridge.call("store.get", { key: STORE_KEY }).catch(() => ({}));
  const list = Array.isArray(kept?.value) ? kept.value : [];
  /** @type {Computer[]} */
  const out = [];
  for (const raw of list) {
    try {
      const computer = normalize(raw);
      if (!out.some((c) => c.id === computer.id)) out.push(computer);
    } catch {
      // A hand-edited or older entry that does not pass stays out of the list.
    }
  }
  return out;
}

/** Keep the list; it must fit the store's 64 KiB. @param {Bridge} bridge @param {Computer[]} list */
export async function saveComputers(bridge, list) {
  if (JSON.stringify(list).length > STORE_LIMIT)
    throw new Error("Too many computers to keep: remove some first.");
  await bridge.call("store.set", { key: STORE_KEY, value: list });
}

/**
 * The list with `computer` in it: replacing the one with its id, else the one at the same address,
 * else added at the end.
 * @param {Computer[]} list
 * @param {Computer} computer
 */
export function upsert(list, computer) {
  const same = (/** @type {Computer} */ c) =>
    c.id === computer.id || (c.host === computer.host && c.port === computer.port);
  const index = list.findIndex(same);
  if (index < 0) return [...list, computer];
  const kept = /** @type {Computer} */ (list[index]);
  return list.map((c, i) => (i === index ? { ...computer, id: kept.id } : c));
}

/** The list without the computer `id`. @param {Computer[]} list @param {string} id */
export function remove(list, id) {
  return list.filter((c) => c.id !== id);
}
