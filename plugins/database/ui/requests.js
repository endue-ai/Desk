// The desk's requests the plugin answers: a buffer of its own shown or closed (desk.buffers.show and
// .closed), and a SQLite file opened with it (desk.files.visit). A database file has nothing to
// save or revert: every run is written by the client. No DOM.

/**
 * @param {{
 *   commands: { on(name: string, handler: (args: unknown) => unknown): void },
 *   consoles: { show(id: string): boolean, closed(id: string): void },
 *   visit(buffer: string, path: string): Promise<void>,
 * }} deps
 */
export function answerRequests({ commands, consoles, visit }) {
  commands.on("desk.buffers.show", (args) => consoles.show(bufferOf(args)));
  commands.on("desk.buffers.closed", (args) => consoles.closed(bufferOf(args)));
  commands.on("desk.files.visit", (args) => {
    const { buffer, path } = /** @type {{ buffer?: string, path?: string }} */ (args ?? {});
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    return visit(buffer, path);
  });
  commands.on("desk.files.save", () => undefined);
  commands.on("desk.files.revert", () => undefined);
}

/** The buffer id a desk request names. */
const bufferOf = (/** @type {unknown} */ args) =>
  /** @type {{ buffer?: string }} */ (args)?.buffer ?? "";
