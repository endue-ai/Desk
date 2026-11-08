// Rendering a new plugin folder: the options every kind takes, and the kind's template.

import { KINDS, type TemplateKind } from "./kinds";

export type { TemplateKind } from "./kinds";

export interface PluginOptions {
  /** Manifest id, already checked with `checkId`. */
  id: string;
  /** Display name, shown as the surface title and the page heading. */
  name: string;
  /** One sentence about what the plugin does; left out of the manifest when absent. */
  description?: string;
  /** `ui` when absent. */
  kind?: TemplateKind;
  /**
   * A theme's test imports the theme compiler from the Desk repository: its path relative to the
   * new folder, with `/`. `../..` (the folder in the repository's `plugins/` or `examples/`) when
   * absent.
   */
  desk?: string;
}

/** Every file of the plugin folder, keyed by its path relative to the folder. */
export function renderPlugin(options: PluginOptions): Record<string, string> {
  return KINDS[options.kind ?? "ui"].render(options);
}
