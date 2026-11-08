// The smallest UI plugin's entry: it connects the plugin in ./plugin.js to the desk. Edit either
// file while `just dev` runs: only this surface reloads, and the count comes back because it lives
// in plugin state, not in the page.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
// The elements define themselves on import; the page uses <desk-button>.
import "@endue-ai/ui";
import { plugin } from "./plugin.js";

defineUiPlugin(plugin);
