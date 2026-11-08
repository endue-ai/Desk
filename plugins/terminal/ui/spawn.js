// Starting a terminal's program in a PTY (proc.spawn), asking the person once when the plugin's
// grants do not cover it. No DOM.

/** @typedef {{ command: string, args: string[], cwd: string, title?: string }} Program */

/** A bridge error's code, `error` when it has none. */
export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** The proc:spawn scope a program runs under. */
export const scopeOf = (/** @type {string} */ command) =>
  /** @type {const} */ ({ permission: "proc:spawn", commands: [command], pty: true });

/**
 * proc.spawn, asking once with perm.request when the grants do not cover the program; a refusal
 * rejects with `permission_denied`.
 * @param {{ call(method: string, params: unknown): Promise<any> }} bridge
 * @param {Program} program
 * @param {{ env: Record<string, string>, cols: number, rows: number }} options
 * @returns {Promise<{ procId: string }>}
 */
export async function spawnProgram(bridge, program, { env, cols, rows }) {
  const scope = scopeOf(program.command);
  const params = {
    command: program.command,
    args: program.args,
    cwd: program.cwd,
    env,
    pty: { cols, rows },
    scope,
  };
  try {
    return await bridge.call("proc.spawn", params);
  } catch (error) {
    if (codeOf(error) !== "permission_denied") throw error;
  }
  const reason = `To run ${program.command} in a terminal`;
  const asked = await bridge
    .call("perm.request", { permission: scope, reason })
    .catch(() => ({ granted: false }));
  if (!asked.granted) throw Object.assign(new Error("refused"), { code: "permission_denied" });
  return bridge.call("proc.spawn", params);
}
