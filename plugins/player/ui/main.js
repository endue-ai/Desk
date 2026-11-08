// The player: every video and audio file in one player, with subtitles and playlists. It uses only
// the public SDK and bridge API, exactly as a community plugin would. What the webview cannot play
// is remuxed for Media Source Extensions or decoded by FFmpeg in a worker (ADR 0050).
import { byteSource, defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import "@endue-ai/ui";
import { scopeOf } from "./access.js";
import { createPlayer } from "./player.js";
import { createView } from "./view.js";

const Offline =
  globalThis.OfflineAudioContext ?? /** @type {any} */ (globalThis).webkitOfflineAudioContext;
const Live = globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext;

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const file = (/** @type {string} */ path) => ({ path, scope: scopeOf(path) });
    const view = createView(document, (name, ...args) => app?.[name]?.(...args), {
      startWorker: () => startWorker(new URL("./software/worker.js", import.meta.url)),
      wasm: new URL("./vendor/ffmpeg/ffmpeg.wasm", import.meta.url).href,
      source: (path) => byteSource(ctx, file(path)),
      readAll: async (path) => {
        const bytes = await readBytes(ctx, file(path));
        return /** @type {ArrayBuffer} */ (
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        );
      },
      audioContext: Live ? () => new Live() : undefined,
    });
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
