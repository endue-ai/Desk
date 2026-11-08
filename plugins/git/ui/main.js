// The Git plugin: a keyboard-first front for a repository on one surface. It uses only the public SDK
// and bridge API, exactly as a community plugin would.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createGit } from "./git.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (action, ...args) => app?.[action]?.(...args));
    const cancelled = (/** @type {string} */ message) =>
      new CommandFailed("endue.git.commit", "cancelled", message);
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (createGit(ctx, view, { cancelled }))
    );
  },
});
