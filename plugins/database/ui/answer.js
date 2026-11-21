// How the plugin's commands and the view's actions meet a failure: its words go to the status line
// and a cancel stays quiet. A command's failure still ends its request (the palette or the agent
// hears it); an action's never reaches the DOM. Each command id is answered once. No DOM.

/**
 * @typedef {{ say(text: string): void }} Said
 * @typedef {(name: string, handler: (args: any) => unknown) => void} Answer
 */

/** The bridge or command code an error carries, if any. */
export const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code;

const words = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * The plugin's way of answering a command: the handler gets its arguments (`{}` when none) and a
 * failure is said before it ends the request.
 * @param {{ on(name: string, handler: (args: unknown) => unknown): void }} commands
 * @param {Said} view
 * @returns {Answer}
 */
export function answerer(commands, view) {
  /** @type {Set<string>} */
  const answered = new Set();
  return (name, handler) => {
    if (answered.has(name)) throw new Error(`${name} is answered twice.`);
    answered.add(name);
    commands.on(name, async (args) => {
      try {
        return await handler(args ?? {});
      } catch (error) {
        if (codeOf(error) !== "cancelled") view.say(words(error));
        throw error;
      }
    });
  };
}

/**
 * The guard of the view's buttons and keys: a failure is said, never thrown at the DOM.
 * @param {Said} view
 */
export const guarded =
  (view) =>
  (/** @type {(...args: any[]) => unknown} */ fn) =>
  async (/** @type {unknown[]} */ ...args) => {
    try {
      const done = await fn(...args);
      return done;
    } catch (error) {
      if (codeOf(error) !== "cancelled") view.say(words(error));
      return undefined;
    }
  };
