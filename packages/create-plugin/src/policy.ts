// The files of a new policy plugin: commands and keys as data in plugin.json `contributes` (ADR
// 0017), and a test. No code: the desk layers it over its defaults while it is on.

import type { PluginManifest } from "@endue-ai/bridge";
import { checkSection, devSection, heading } from "./readme";
import type { PluginOptions } from "./template";

/** Every file of the policy plugin's folder, keyed by its path relative to the folder. */
export function renderPolicy(options: PluginOptions): Record<string, string> {
  return {
    "plugin.json": manifest(options),
    "README.md": readme(options),
    "tests/policy.test.js": POLICY_TEST,
  };
}

function manifest({ id, name, description }: PluginOptions): string {
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "policy",
    ...(description === undefined ? {} : { description }),
    contributes: {
      commands: [
        {
          id: `${id}.today`,
          title: "Open today",
          keywords: ["today", "agenda"],
          runs: { command: "desk.views.open", args: { id: "desk.today" } },
        },
      ],
      keys: [{ key: "Mod+Alt+T", command: `${id}.today` }],
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(options: PluginOptions): string {
  return [
    ...heading(options, "A Desk policy: a key that opens today."),
    ...devSection(
      "Press Mod+Alt+T (Command on macOS, Control elsewhere): today opens. Turn the plugin off and the key goes with it.",
    ),
    "## What it is",
    "",
    "A policy is data, not code (ADR 0017): `contributes` in `plugin.json` adds to the desk's",
    "defaults while the plugin is on. Here `commands` holds an alias, which the desk answers by",
    "running `runs.command` with `runs.args`, and `keys` binds a key to it. `display`, `files`,",
    "`settings` and `profiles` work the same way (`specs/plugin/v0/contributes.schema.json`).",
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): kind `policy`, one command and one key |",
    "| `tests/policy.test.js` | Its test, on the SDK's test host |",
    "",
    ...checkSection(
      [
        "`plugin test` runs `tests/*.test.js` with vitest on the SDK's test host: the test checks that",
        "each key runs a command the plugin contributes, and runs the alias's command there as the",
        "desk would.",
      ].join("\n"),
    ),
  ].join("\n");
}

const POLICY_TEST = `// The policy on the SDK's test host: a desk in memory with a command registry. \`desk plugin test
// <this folder>\` runs it with vitest.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
const { commands = [], keys = [] } = manifest.contributes;

it("binds its key to its own command, which opens today", async () => {
  const own = new Set(commands.map((command) => command.id));
  for (const key of keys) expect(own.has(key.command), key.key).toBe(true);

  // The desk answers an alias by running \`runs.command\` with \`runs.args\`, as the desk does
  // here; the test host provides that command and records what it was asked.
  const opened = [];
  const host = createTestHost({
    pluginId: manifest.id,
    commands: { "desk.views.open": (args) => void opened.push(args) },
  });
  const [{ runs }] = commands;
  const scope = { permission: "cmd:invoke", ids: [runs.command] };
  await host.call("cmd.invoke", { id: runs.command, args: runs.args, scope });
  await host.settle();
  expect(opened).toEqual([{ id: "desk.today" }]);
});
`;
