// Screen Sharing: another computer's screen in a desk window, over VNC (RFB), the protocol macOS
// Screen Sharing speaks. The public SDK and bridge API only, as a community plugin would: the TCP
// connection is the core's (net.connect, ADR 0133), noVNC (vendored, MPL-2.0) draws the screen and
// sends the keys and the pointer. app.js holds the behaviour, view.js the DOM.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createScreens } from "./app.js";
import { createSockets } from "./channel.js";
import RFB from "./vendor/novnc/core/rfb.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createScreens> | undefined} */
    let app;
    const view = createView(document, {
      connect: (raw) => app?.connect(raw),
      remove: (id) => app?.remove(id),
      disconnect: () => app?.disconnect(),
      viewOnly: (on) => app?.setViewOnly(on),
      fit: (on) => app?.setFit(on),
    });
    const sockets = createSockets(ctx.bridge);
    app = createScreens({ bridge: ctx.bridge, sockets, RFB, view });
    app.wire(ctx.commands);
    // The frame going away ends its connections; the core would close them with the plugin anyway.
    window.addEventListener("pagehide", () => {
      app?.disconnect();
      sockets.dispose();
    });
    await app.start();
  },
});
