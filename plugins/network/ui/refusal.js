// Why the plugin will not do something, as a code with its parameters (NF-02). The words are the
// catalog's `refusal.<code>` (what happened) and `refusal.<code>.do` (what to do), so the screen, a
// command's answer and a notification say the same sentence in the desk's language.

export const REFUSALS = Object.freeze([
  "public",
  "other-range",
  "invalid",
  "no-network",
  "not-admin",
  "admin-unasked",
  "ports-denied",
  "programs-denied",
  "missing-program",
  "unsupported-os",
  "unsupported-proc",
  "unsupported-net",
  "wifi-missing",
  "wifi-off",
  "unknown-device",
]);

/** @typedef {(typeof REFUSALS)[number]} RefusalCode */

export class NetworkRefusal extends Error {
  /**
   * @param {RefusalCode} code
   * @param {Record<string, string | number>} [params]
   */
  constructor(code, params = {}) {
    super(code);
    this.name = "NetworkRefusal";
    this.code = code;
    this.params = params;
  }
}

/** @param {unknown} error @returns {error is NetworkRefusal} */
export function isRefusal(error) {
  return error instanceof NetworkRefusal;
}

/** The message ids a refusal reads with: [what happened, what to do]. @param {RefusalCode} code */
export function refusalKeys(code) {
  const id = code.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  return [`refusal.${id}`, `refusal.${id}.do`];
}

/**
 * A refusal in words, through the catalog.
 * @param {(id: string, params?: Record<string, unknown>) => string} t
 * @param {NetworkRefusal} refusal
 */
export function refusalText(t, refusal) {
  const [what, todo] = refusalKeys(refusal.code);
  return { code: refusal.code, text: t(what, refusal.params), todo: t(todo, refusal.params) };
}
