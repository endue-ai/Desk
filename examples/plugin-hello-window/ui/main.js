// The app's entry: it connects the plugin in ./plugin.js to the desk. The same page runs in a
// window on the canvas and in an OS window of its own; nothing here tells the two apart.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
// The elements define themselves on import; the page uses <desk-button>.
import "@endue-ai/ui";
import { plugin } from "./plugin.js";

defineUiPlugin(plugin);
