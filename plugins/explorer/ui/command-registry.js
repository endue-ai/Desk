// Register explorer commands and surface failures on the status line. A command is the person's
// next action: it starts from a clear line, and says what it did or why it failed.
/** @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext */

/** @param {PluginContext["commands"]} commands @param {(text: string) => void} say */
export function commandRegistry(commands, say) {
  /** @type {Map<string, (args: Record<string, unknown>) => unknown>} */
  const own = new Map();
  /** @param {string} name @param {unknown} raw */
  const command = async (name, raw) => {
    const handler = own.get(name);
    if (!handler) throw new Error(`the explorer has no command ${name}.`);
    say("");
    try {
      const args = /** @type {Record<string, unknown>} */ (
        raw && typeof raw === "object" ? raw : {}
      );
      return await handler(args);
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  /** @type {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} */
  const answer = (name, handler) => {
    own.set(name, handler);
    commands.on(name, (raw) => command(name, raw));
  };
  return { command, answer };
}
