// The entry: the elements define themselves on import (<desk-universal-view>), then the plugin
// in ./plugin.js connects to the desk.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import "@endue-ai/ui";
import { plugin } from "./plugin.js";

defineUiPlugin(plugin);
