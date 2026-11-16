// The model servers the window talks to: those found on this computer's usual ports, and those the
// person added (another port, a computer on the network, a key). Each is Ollama or OpenAI-compatible;
// the same calls reach either through clientOf().
import * as ollama from "./ollama.js";
import * as openai from "./openai.js";

/**
 * @typedef {"ollama" | "openai"} Kind
 * @typedef {{
 *   id: string,
 *   kind: Kind,
 *   label: string,
 *   host: string,
 *   port: number,
 *   baseUrl: string,
 *   apiKey?: string,
 *   added?: boolean,
 *   managed?: boolean,
 *   flavor?: string,
 *   version?: string,
 *   ctx?: number,
 *   status: "online" | "offline" | "checking",
 *   error?: string,
 *   checkedAt?: number,
 * }} Server
 * @typedef {{ host: string, port: number, kind?: Kind, label?: string, apiKey?: string }} ServerSpec
 */

/** The ports model servers listen on by default, looked at on this computer. */
export const KNOWN = Object.freeze([
  { port: 11434, kind: /** @type {Kind} */ ("ollama") },
  { port: 1234, kind: /** @type {Kind} */ ("openai") },
  { port: 8080, kind: /** @type {Kind} */ ("openai") },
  { port: 1337, kind: /** @type {Kind} */ ("openai") },
  { port: 8000, kind: /** @type {Kind} */ ("openai") },
  { port: 5001, kind: /** @type {Kind} */ ("openai") },
]);

/** @param {string} host @param {number} port */
export const serverId = (host, port) => `${host.toLowerCase()}:${port}`;

/** @param {Kind} kind */
export const clientOf = (kind) => (kind === "ollama" ? ollama : openai);

/** A label for a server: what it is, and where when it is not here. @param {Kind} kind @param {string | undefined} flavor @param {string} host @param {number} port */
export function labelOf(kind, flavor, host, port) {
  const what =
    kind === "ollama" ? "Ollama" : flavor === "llama.cpp" ? "llama.cpp" : "OpenAI-compatible";
  const local = host === "127.0.0.1" || host === "localhost";
  return local ? `${what} :${port}` : `${what} · ${host}:${port}`;
}

/**
 * Look at one address: Ollama first when the kind is not known, then OpenAI-compatible.
 * @param {import("./http.js").Sockets} sockets @param {ServerSpec} spec
 * @returns {Promise<Server>}
 */
export async function check(sockets, spec) {
  const baseUrl = `http://${spec.host}:${spec.port}`;
  const id = serverId(spec.host, spec.port);
  const base = { id, host: spec.host, port: spec.port, baseUrl, apiKey: spec.apiKey };
  const kinds = spec.kind ? [spec.kind] : /** @type {Kind[]} */ (["ollama", "openai"]);
  for (const kind of kinds) {
    const found = await clientOf(kind).probe(sockets, { ...base, id });
    if (found)
      return {
        ...base,
        kind,
        flavor: "flavor" in found ? found.flavor : undefined,
        ctx: "ctx" in found ? found.ctx : undefined,
        version: found.version,
        label:
          spec.label ||
          labelOf(kind, "flavor" in found ? found.flavor : undefined, spec.host, spec.port),
        status: "online",
        checkedAt: Date.now(),
      };
  }
  return {
    ...base,
    kind: spec.kind ?? "openai",
    label: spec.label || labelOf(spec.kind ?? "openai", undefined, spec.host, spec.port),
    status: "offline",
    checkedAt: Date.now(),
  };
}

/**
 * Every server answering: the known local ports and the added ones, looked at side by side.
 * @param {import("./http.js").Sockets} sockets @param {ServerSpec[]} added
 * @returns {Promise<Server[]>}
 */
export async function discover(sockets, added = []) {
  const specs = [
    ...KNOWN.map((k) => ({ host: "127.0.0.1", port: k.port, kind: k.kind })),
    ...added,
  ];
  const seen = new Set();
  const unique = specs.filter((s) => {
    const id = serverId(s.host, s.port);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const addedIds = new Set(added.map((a) => serverId(a.host, a.port)));
  const results = await Promise.all(
    unique.map((spec) =>
      check(sockets, spec).then((server) => ({ ...server, added: addedIds.has(server.id) })),
    ),
  );
  return results.filter((s) => s.status === "online" || s.added);
}
