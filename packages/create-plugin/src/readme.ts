// What every template's README shares: the title, the id and how to check and test the folder.

import type { PluginOptions } from "./template";

export const FENCE = "```";

/** The README's opening: the name, what it does and the id. */
export function heading({ id, name, description }: PluginOptions, otherwise: string): string[] {
  return [
    `# ${name}`,
    "",
    description ?? otherwise,
    "",
    `Id: \`${id}\`. Ids are lowercase and reverse-domain; use a domain you own before you publish.`,
    "",
  ];
}

/** "Check and test it": `desk plugin validate` and `desk plugin test`, and what the test runs on. */
export function checkSection(test: string): string[] {
  return [
    "## Check and test it",
    "",
    "From the Desk repository:",
    "",
    `${FENCE}bash`,
    "cargo run -p desk-cli -- plugin validate /path/to/this/folder",
    "cargo run -p desk-cli -- plugin test /path/to/this/folder",
    FENCE,
    "",
    test,
    "",
    "Guide: `docs/plugins/authoring.md` in the Desk repository.",
    "",
  ];
}

/** "Run it": the folder as a dev plugin of a running desk. */
export function devSection(after: string): string[] {
  return [
    "## Run it",
    "",
    "From the Desk repository, run Desk with this folder as a dev plugin:",
    "",
    `${FENCE}bash`,
    "DESK_DEV_PLUGINS=/path/to/this/folder just dev",
    FENCE,
    "",
    after,
    "",
  ];
}
