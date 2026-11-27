/** Agent-facing commands for the desk's declared preferences. */
import type { BridgeClient } from "@endue-ai/bridge";
import { SETTINGS_TOOLS } from "../agent-specs";
import { CommandError } from "../commands";
import { Preferences } from "../core/preferences";
import type { PolicyHub } from "../hub";
import { schemaFits } from "../settings";

const PROTECTED = new Set([
  "desk.buffers.confirm-unsaved",
  "desk.design.markets",
  "desk.files.fallback",
  "desk.files.history-max-bytes",
  "desk.files.history-max-versions",
  "desk.keys.bindings",
  "desk.login.start",
  "desk.market.indexes",
  "desk.notify.history",
  "desk.roles",
  "desk.session.save-history",
  "desk.shell.shortcuts",
  "desk.theme.markets",
  "endue.android-emulator.sdk",
  "endue.api-studio.curl",
  "endue.computer.apps",
  "endue.computer.stop-key",
  "endue.data.mask-secrets",
  "endue.database.confirm",
  "endue.database.mysql",
  "endue.database.path",
  "endue.database.pg-dump",
  "endue.database.pg-restore",
  "endue.database.sqlite3",
  "endue.docker.confirm",
  "endue.docker.context",
  "endue.docker.path",
  "endue.docker.reveal-env",
  "endue.docker.shell",
  "endue.docker-studio.confirm",
  "endue.docker-studio.path",
  "endue.docker-studio.shell",
  "endue.eris.shortcut",
  "endue.git.confirm",
  "endue.local-agents.access",
  "endue.local-agents.confirm",
  "endue.local-agents.folder",
  "endue.local-agents.path",
  "endue.terminal.args",
  "endue.terminal.cwd",
  "endue.terminal.env",
  "endue.terminal.event-commands",
  "endue.terminal.keys-to-desk",
  "endue.terminal.login",
  "endue.terminal.paste-warning",
  "endue.terminal.program-copy",
  "endue.terminal.shell",
]);

const PRIVATE = "endue.terminal.env";

export function installSettingCommands(hub: PolicyHub, bridge: BridgeClient): Preferences {
  const { settings, commands } = hub;
  const preferences = new Preferences(settings, bridge);
  commands.define("desk.settings.get", {
    title: "Read settings",
    owner: "desk",
    agent: SETTINGS_TOOLS.get,
    run(args) {
      const { key, prefix } = (args ?? {}) as { key?: string; prefix?: string };
      if (key !== undefined && prefix !== undefined)
        throw new CommandError("failed", "Give a key or a prefix");
      if (key !== undefined) {
        if (key === PRIVATE)
          throw new CommandError("failed", "The terminal environment is private");
        const entry = settings.describe(key);
        if (!entry) throw new CommandError("failed", `No declared setting ${key}`);
        return entry;
      }
      return settings
        .declaredKeys()
        .filter((name) => name !== PRIVATE && name.startsWith(prefix ?? ""))
        .map((name) => settings.describe(name));
    },
  });
  commands.define("desk.settings.set", {
    title: "Set a preference",
    owner: "desk",
    agent: SETTINGS_TOOLS.set,
    run(args) {
      const { key, value } = (args ?? {}) as { key?: string; value?: unknown };
      const declared = key && settings.declaration(key);
      if (!key || !declared) throw new CommandError("failed", `No declared setting ${key ?? ""}`);
      if (PROTECTED.has(key)) throw new CommandError("failed", `Use Settings to change ${key}`);
      if (!schemaFits(declared, value))
        throw new CommandError("failed", `Value does not fit the declared setting ${key}`);
      preferences.set(key, value);
      return settings.describe(key);
    },
  });
  return preferences;
}
