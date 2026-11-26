// Agent words for the file on screen. Playback uses the same transport as the page's keyboard.
import { titleOf } from "./model.js";

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {ReturnType<typeof import("./view-media.js").createMedia>["transport"]} Transport
 */

/** @param {Entry | undefined} entry @param {Transport | undefined} transport */
function snapshot(entry, transport) {
  if (!entry) return { mode: "empty", playing: false };
  const { item, playlist, subs, mode, path, name } = entry;
  const info = item?.info;
  const row = playlist?.entries[playlist.index];
  return {
    mode,
    path,
    title: titleOf({ mode, info, item, name }),
    tags: info?.tags ?? {},
    position: entry.position,
    duration: info?.duration ?? null,
    playing: false,
    entry:
      playlist && row?.path && row.path === item?.path
        ? {
            index: playlist.index + 1,
            count: playlist.entries.length,
            path: row.path,
            title: row.title,
          }
        : null,
    subtitles: subs
      ? { selected: subs.selected, options: subs.options, offset: subs.offset }
      : null,
    ...transport?.state(),
  };
}

/** @param {unknown} value @param {string} message */
function finite(value, message) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext["commands"], "on">} commands
 * @param {{
 *   ready(): Promise<unknown> | undefined,
 *   current(): Entry | undefined,
 *   transport?: Transport,
 *   controls: ReturnType<typeof import("./controls.js").createPlayerControls>,
 * }} parts
 */
export function installAgentCommands(commands, { ready, current, transport, controls }) {
  commands.on("endue.player.state", async () => {
    await ready();
    return snapshot(current(), transport);
  });
  /**
   * @param {string} name
   * @param {(args: Record<string, unknown>, entry: Entry) => unknown} run
   */
  const answer = (name, run) =>
    commands.on(`endue.player.${name}`, async (raw) => {
      await ready();
      const entry = current();
      if (!entry) throw new Error("No file is open in Player.");
      await run(/** @type {Record<string, unknown>} */ (raw ?? {}), entry);
      if (current() !== entry) throw new Error("The active Player item changed.");
      return snapshot(entry, transport);
    });
  const active = () => {
    const state = transport?.state();
    if (!transport || !state) throw new Error("No playable media is loaded.");
    return { transport, state };
  };
  answer("play", () => active().transport.setPlaying(true));
  answer("pause", () => active().transport.setPlaying(false));
  answer("seek", ({ to, by }) => {
    const { state, transport } = active();
    const message = "Give exactly one finite seek time, to or by, in seconds.";
    if ((to === undefined) === (by === undefined)) throw new Error(message);
    transport.seekTo(to === undefined ? state.position + finite(by, message) : finite(to, message));
  });
  answer("volume", ({ level, mute }) => {
    const { transport } = active();
    if ((level === undefined) === (mute === undefined))
      throw new Error("Give exactly one of level or mute.");
    if (typeof mute === "boolean") return transport.setMuted(mute);
    const message = "Give a volume level from 0 to 1 or a boolean mute state.";
    const value = finite(level, message);
    if (value < 0 || value > 1) throw new Error(message);
    transport.setVolume(value);
  });
  answer("speed", ({ rate }) => {
    const { transport } = active();
    if (typeof rate !== "number" || !transport.speeds().includes(rate))
      throw new Error("Choose a speed from the transport's available rates.");
    transport.setSpeed(rate);
  });
  answer("subtitles", ({ track, offset }, entry) => controls.subtitle(entry, track, offset));
  answer("entry", ({ to }, entry) => controls.entry(entry, to));
}
