// The permissions plugin: every caller's grants on the right, and the person's side of perm.request in
// an overlay. It uses only the public bridge API, exactly as a community plugin with perm:manage would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createPermissions } from "./controller.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createPermissions> | undefined} */
    let app;
    const view = createView(document, {
      revoke: (grantId) => app?.revoke(grantId),
      answer: (choice) => app?.answer(choice),
      key: (key) => app?.key(key) ?? false,
    });
    app = createPermissions(ctx, view);
    await app.ready;
  },
});
