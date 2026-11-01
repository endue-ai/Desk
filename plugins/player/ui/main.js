// The player: every video and audio file in one player, with subtitles and playlists. It uses only
// the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createPlayer } from "./player.js";
import { createView } from "./view.js";

const Offline =
  globalThis.OfflineAudioContext ?? /** @type {any} */ (globalThis).webkitOfflineAudioContext;

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (name, ...args) => app?.[name]?.(...args));
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (
        createPlayer(ctx, view, {
          objectUrl: (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })),
          revokeUrl: (url) => URL.revokeObjectURL(url),
          audioContext: Offline
            ? (channels, length, rate) => new Offline(channels, length, rate)
            : undefined,
        })
      )
    );
  },
});
