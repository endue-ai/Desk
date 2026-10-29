// Permissions, durations and callers in plain words, and which requests are broad (CORE-03). Plain data
// in, plain data out, so it is tested without a DOM.

/**
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("@endue-ai/bridge").GrantDuration} GrantDuration
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {{ label: string, scope: string }} Described
 * @typedef {{ id: string, name: string, kind: string }} Caller
 */

const list = (/** @type {string[] | undefined} */ items) => (items ?? []).join(", ");

/** @type {Record<string, [string, (p: any) => string]>} */
const WORDS = {
  "fs:read": ["Read files", (p) => list(p.paths)],
  "fs:write": ["Write files", (p) => list(p.paths)],
  "proc:spawn": ["Run programs", (p) => list([...p.commands, ...(p.pty ? ["in a terminal"] : [])])],
  "net:fetch": ["Use the network", (p) => list(p.hosts)],
  "audio:capture": ["Use the microphone", (p) => (p.wakeWord ? "with the wake word" : "")],
  "ui:surface": ["Open its surfaces", () => ""],
  "ui:notify": ["Show notifications", () => ""],
  "plugin:manage": ["Manage plugins", () => ""],
  "brain:converse": ["Talk to the brain", () => ""],
  "cmd:invoke": ["Run commands", (p) => list(p.ids)],
  "cmd:advise": ["Hook into commands", () => ""],
  "settings:read": ["Read settings", (p) => list(p.keys)],
  "log:read": ["Read the logs", () => ""],
  "events:subscribe": ["Watch desk events", (p) => list(p.names)],
  "perm:manage": ["Manage permissions", () => ""],
};

/**
 * What a permission allows and how far its scope reaches. An unknown permission shows its own name.
 * @param {Permission} permission
 * @returns {Described}
 */
export function describePermission(permission) {
  const words = WORDS[permission.permission];
  if (!words) return { label: permission.permission, scope: "" };
  return { label: words[0], scope: words[1](permission) };
}

/** @type {Record<GrantDuration, string>} */
const DURATIONS = { once: "Once", session: "This session", always: "Always" };

/** @param {GrantDuration} duration */
export function durationLabel(duration) {
  return DURATIONS[duration] ?? duration;
}

/** Programs that run whatever they are told to: a grant for one of them is a grant for any program. */
const OPEN_ENDED = new Set(
  [
    "sh bash zsh fish dash ksh csh tcsh nu pwsh powershell cmd env sudo doas xargs",
    "python python3 node deno bun ruby perl php lua osascript",
  ]
    .join(" ")
    .split(" "),
);

/** The program name of a command or absolute path, without a Windows .exe. */
const programOf = (/** @type {string} */ command) =>
  (command.split(/[/\\]/).pop() ?? command).toLowerCase().replace(/\.exe$/, "");

/** Where a path pattern reaches when it covers a whole disk or home folder, else null. */
function widePath(/** @type {string} */ path) {
  const root = path.replace(/(\/\*\*|\/\*)+$/, "").replace(/\/$/, "");
  if (root === "" || /^[A-Za-z]:$/.test(root)) return "on the disk";
  // biome-ignore lint/suspicious/noTemplateCurlyInString: ${home} is a literal path root
  if (root === "~" || root === "${home}") return "in your home folder";
  return null;
}

/**
 * A sentence for a request whose scope is broad, or null. The spec carries no "broad" mark, so the
 * scope decides: an open-ended program, a host wildcard over a whole top-level domain, a file scope
 * over a disk or the home folder, every command, every caller's settings, or the permissions themselves.
 * @param {Permission} permission
 * @returns {string | null}
 */
export function broadWarning(permission) {
  switch (permission.permission) {
    case "proc:spawn": {
      const program = permission.commands.map(programOf).find((name) => OPEN_ENDED.has(name));
      return program ? `It can run any program through ${program}.` : null;
    }
    case "net:fetch": {
      const host = permission.hosts.find((h) => /^\*\.[a-z0-9-]+(:[0-9]+)?$/.test(h));
      return host ? `It can reach every site under ${host.slice(1)}.` : null;
    }
    case "fs:read":
    case "fs:write": {
      const where = permission.paths.map(widePath).find(Boolean);
      const verb = permission.permission === "fs:read" ? "read" : "change";
      return where ? `It can ${verb} every file ${where}.` : null;
    }
    case "cmd:invoke":
      return permission.ids.some((id) => id.startsWith("*")) ? "It can run every command." : null;
    case "settings:read":
      return permission.keys.some((key) => key.startsWith("*"))
        ? "It can read the settings of every plugin."
        : null;
    case "perm:manage":
      return "It can see and revoke every permission, and answer permission requests.";
    default:
      return null;
  }
}

/** @type {Record<string, string>} */
const PLUGIN_KINDS = { ui: "UI plugin", logic: "Logic plugin", tool: "Tool plugin" };

/**
 * Who a caller is: an installed plugin by its manifest name and kind, the desk by its own names.
 * The id always travels with the name, so a plugin cannot pass for another by name.
 * @param {string} id
 * @param {PluginInfo[]} plugins
 * @returns {Caller}
 */
export function describeCaller(id, plugins) {
  const manifest = plugins.find((p) => p.id === id)?.manifest;
  if (manifest)
    return { id, name: manifest.name || id, kind: PLUGIN_KINDS[manifest.kind] ?? "Plugin" };
  if (id === "desk") return { id, name: "Desk", kind: "Runtime" };
  if (id === "core") return { id, name: "Desk", kind: "Core" };
  return { id, name: id, kind: id.includes(".") ? "Plugin" : "Desk" };
}
