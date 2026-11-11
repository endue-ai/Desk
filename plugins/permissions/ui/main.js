// The permissions plugin: the person's side of perm.request and of an agent's approval, in an overlay
// over the whole desk, and every caller's grants when the person opens it. It uses only the public
// bridge API, exactly as a community plugin with perm:manage would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createPermissions } from "./controller.js";
import { wireRuns } from "./runs.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createPermissions> | undefined} */
    let app;
    const view = createView(document, {
      revoke: (grantId) => app?.revoke(grantId),
      allow: (key) => app?.allow(key),
      answer: (choice) => app?.answer(choice),
      key: (key) => app?.key(key) ?? false,
      close: () => app?.close(),
      dismiss: () => app?.dismiss(),
    });
    app = createPermissions(ctx, view);
    // The desk shows the overlay itself when the person opens Permissions (the palette, Eris): the
    // page hears it as being shown (the app's browser) or focused (a frame), and shows the list. A
    // card it raised for itself says so first, so this is no list then.
    const visible = () => document.visibilityState === "visible";
    document.addEventListener("visibilitychange", () =>
      visible() ? app?.opened() : app?.hidden(),
    );
    window.addEventListener("focus", () => visible() && app?.opened());
    // The fleet board's Approve, Deny and Stop (ADR 0100).
    wireRuns(ctx);
    await app.ready;
  },
});
