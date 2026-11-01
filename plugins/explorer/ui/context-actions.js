// Selection commands delegate to the owning plugin; only system reveal uses a bridge grant here.
import { folderOf } from "./tree.js";

/** @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext */
/** @typedef {import("./tree.js").Row} Row */
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;

/**
 * @param {PluginContext["bridge"]} bridge
 * @param {PluginContext["commands"]} commands
 * @param {{ selected(): Row | undefined, open(row: Row): Promise<unknown> }} deps
 */
export function contextActions(bridge, commands, { selected, open }) {
  const picked = () => {
    const row = selected();
    if (!row || row.kind === "more") throw new Error("Select a file or folder first.");
    return row;
  };
  const folder = () => {
    const path = folderOf(picked());
    if (!path) throw new Error("The selected file has no containing folder.");
    return path;
  };
  const invoke = async (
    /** @type {string} */ provider,
    /** @type {() => Promise<unknown>} */ run,
  ) => {
    try {
      return await run();
    } catch (error) {
      if (codeOf(error) === "unknown_command") throw new Error(`${provider} is not available.`);
      const why = error instanceof Error ? error.message : String(error);
      throw new Error(`${provider}: ${why.replace(/^[a-z.-]+: [a-z_]+: /, "")}`);
    }
  };
  const reveal = async () => {
    const { path } = picked();
    // Bridge path scopes use wildcards. Do not turn a literal filename into a broader grant.
    if (/[*?]/u.test(path))
      throw new Error("Cannot request an exact reveal grant for a path with wildcard characters.");
    const scope = { permission: /** @type {const} */ ("shell:open"), paths: [path] };
    const params = { target: path, reveal: true, scope };
    const refused = new Error(`Not allowed to show ${path} in the system file manager.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not show ${path}: ${codeOf(error) ?? "error"}.`);
    try {
      return await bridge.call("shell.open", params);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    const decision = await bridge
      .call("perm.request", {
        permission: scope,
        reason: `To show ${path} in the system file manager`,
      })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    return bridge.call("shell.open", params).catch((error) => {
      throw failed(error);
    });
  };
  return {
    "endue.explorer.open-selected": async () => open(picked()),
    "endue.explorer.terminal-here": async () => {
      const cwd = folder();
      return invoke("Terminal", () => commands.run("endue.terminal.new", { cwd }));
    },
    "endue.explorer.git-here": async () => {
      const path = folder();
      return invoke("Git", () => commands.run("endue.git.status", { path }));
    },
    "endue.explorer.show-in-file-manager": reveal,
  };
}
