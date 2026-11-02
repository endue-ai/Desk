// The kinds create-plugin scaffolds, one entry each: `--kind` takes these names, the usage lists
// them with `about`, and the CLI prints each one's next steps from `build` and `dev`. A new kind is
// one entry here and the module that renders its folder.

import { renderConnector } from "./connector";
import { renderLogic } from "./logic";
import { renderPolicy } from "./policy";
import type { PluginOptions } from "./template";
import { renderUi } from "./ui";
import { renderView } from "./view";

export interface Kind {
  /** What the folder is, for the usage. */
  about: string;
  /** Every file of the folder, keyed by its path relative to the folder. */
  render(options: PluginOptions): Record<string, string>;
  /** A Rust crate that `cargo build --release` must build for wasm32-wasip2 first. */
  build: boolean;
  /** A running desk shows it as a dev plugin (`DESK_DEV_PLUGINS`), reloading it on save. */
  dev: boolean;
}

export const KINDS = {
  ui: { about: "a page in a sandboxed frame", render: renderUi, build: false, dev: true },
  logic: {
    about: "a Wasm component in Rust (desk:host)",
    render: renderLogic,
    build: true,
    dev: false,
  },
  connector: {
    about: "a Wasm connector in Rust (desk:connector)",
    render: renderConnector,
    build: true,
    dev: false,
  },
  view: { about: "a view, as data", render: renderView, build: false, dev: true },
  policy: { about: "commands and keys, as data", render: renderPolicy, build: false, dev: true },
} satisfies Record<string, Kind>;

/** What the folder holds. */
export type TemplateKind = keyof typeof KINDS;

export function isKind(name: string): name is TemplateKind {
  return Object.hasOwn(KINDS, name);
}
