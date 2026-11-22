// What a PostgreSQL session's sign-in ends with when db.open throws: the grant refused, a desk that
// serves no db.*, or the connection's own failure, each in words naming `where` (pg-session.js).
// No DOM.

/** @typedef {import("./common.js").DbError} DbError */

/** The error's code, "error" when it has none. */
export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
/** The error's sentence. */
export const textOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** @returns {{ error: DbError }} */
export function openFailed(/** @type {unknown} */ error, /** @type {string} */ where) {
  const code = codeOf(error);
  if (code === "permission_denied")
    return { error: { kind: "refused", message: `Not allowed to connect to ${where}.` } };
  if (code === "unsupported")
    return {
      error: {
        kind: "client",
        message: "This desk cannot open database sessions: db.* is unsupported.",
      },
    };
  return {
    error: { kind: "connect", message: `Could not connect to ${where}: ${textOf(error)}` },
  };
}
