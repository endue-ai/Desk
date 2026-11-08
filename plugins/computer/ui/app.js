// endue.computer put together (ADR 0123): Eris's tools as the plugin's commands, each act naming
// the invocation it serves; Stop and Resume as commands; the Computer page. The scope of every call
// is the person's app list (the setting endue.computer.apps): empty is every app. The view is
// handed in, so the tests mount it on the SDK's test host without a DOM.
import { createInvocations, isAgent } from "./invocations.js";
import { createPage } from "./page.js";
import { createTools, PREFIX, TOOLS } from "./tools.js";

const STOP = `${PREFIX}stop`;
const RESUME = `${PREFIX}resume`;
const TITLES = {
  look: "Computer: Look at the screen",
  find: "Computer: Find on the screen",
  click: "Computer: Click",
  type: "Computer: Type",
  keys: "Computer: Press keys",
  scroll: "Computer: Scroll",
  open: "Computer: Open an app",
  switch: "Computer: Switch to an app",
  apps: "Computer: Running apps",
};

/**
 * @typedef {import("./page.js").View} View
 * @typedef {{ bridge: import("./page.js").Bridge,
 *   settings: import("./page.js").Settings & { onChange(listener: (setting: any) => void): () => void },
 *   commands: { on(name: string, handler: (args: unknown) => unknown): () => void } }} Context
 */

/** What a failed act tells the agent, in words it can act on. */
export function explain(/** @type {any} */ error) {
  const code = error?.code;
  const text = error instanceof Error ? error.message : String(error);
  if (code === "cancelled") {
    return "The person stopped computer use. Tell them, and ask them to resume it on the Computer page.";
  }
  if (code === "permission_denied" && /did not approve/.test(text)) {
    return "The person did not approve this. Ask them what to do instead.";
  }
  if (code === "permission_denied" && /Accessibility|Screen Recording/.test(text)) {
    return "macOS has not let the desk use the computer yet. Ask the person to open the Computer page and grant it.";
  }
  if (code === "unsupported") return "Computer use is not available on this computer.";
  return text;
}

/**
 * @param {Context} ctx
 * @param {View} view
 */
export function createComputer(ctx, view) {
  const { bridge, settings, commands } = ctx;
  /** @type {string[]} */
  let apps = [];
  const scopes = () => {
    const only = apps.length ? { apps } : {};
    return {
      see: { permission: "computer:see", ...only },
      control: { permission: "computer:control", ...only },
    };
  };
  const loaded = settings
    .get("apps")
    .then((value) => {
      apps = Array.isArray(value) ? value.filter((a) => typeof a === "string") : [];
    })
    .catch(() => {});
  settings.onChange((setting) => {
    if (setting.key === "apps") apps = Array.isArray(setting.value) ? setting.value : [];
  });

  const invocations = createInvocations(bridge, PREFIX);
  const run = createTools(bridge, scopes);
  for (const id of TOOLS) {
    const title = TITLES[/** @type {keyof typeof TITLES} */ (id.slice(PREFIX.length))];
    void bridge.call("cmd.register", { id, title }).catch(() => {});
    commands.on(id, async (args) => {
      const invocation = await invocations.take(id);
      const caller = invocation?.caller ?? "desk";
      // An agent's tools, and the person's own (the palette); another plugin is no deputy here.
      if (!isAgent(caller) && caller !== "desk") {
        throw new Error(
          `${caller} may not use the computer through ${id}; it asks for computer.* itself.`,
        );
      }
      await loaded;
      try {
        return await run(id, args, isAgent(caller) ? invocation : undefined);
      } catch (error) {
        throw new Error(explain(error));
      }
    });
  }

  const page = createPage(ctx, view);
  for (const [id, title, act] of [
    [STOP, "Computer: Stop Eris using the computer", page.stop],
    [RESUME, "Computer: Let Eris use the computer again", page.resume],
  ]) {
    void bridge.call("cmd.register", { id, title }).catch(() => {});
    commands.on(/** @type {string} */ (id), () => /** @type {() => Promise<void>} */ (act)());
  }
  return { page, ready: Promise.all([loaded, page.ready]) };
}
