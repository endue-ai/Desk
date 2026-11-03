// The transport owns one volume and mute state across every engine and persists it between visits.
const KEY = "volume";

/**
 * @param {Document} doc
 * @param {() => import("./engines.js").Media | null} current
 */
export function createVolume(doc, current) {
  const slider = /** @type {HTMLInputElement} */ (doc.getElementById("volume"));
  const mute = /** @type {HTMLElement} */ (doc.getElementById("mute"));
  /** @type {import("@endue-ai/plugin-sdk").PluginContext["bridge"] | undefined} */
  let bridge;
  let changed = false;
  let writes = Promise.resolve();

  const state = () => ({
    volume: Number(slider.value),
    muted: mute.getAttribute("aria-pressed") === "true",
  });
  const apply = () => {
    const media = current();
    if (!media) return;
    const value = state();
    media.volume = value.volume;
    media.muted = value.muted;
  };
  const save = () => {
    changed = true;
    const value = state();
    writes = writes
      .then(async () => {
        await bridge?.call("store.set", { key: KEY, value });
      })
      .catch(() => {});
  };
  const setVolume = (/** @type {number} */ value) => {
    if (!Number.isFinite(value)) return;
    slider.value = String(Math.round(Math.max(0, Math.min(1, value)) * 100) / 100);
    apply();
    save();
  };
  const setMuted = (/** @type {boolean} */ value) => {
    mute.setAttribute("aria-pressed", String(value));
    apply();
    save();
  };
  slider.addEventListener("input", () => setVolume(Number(slider.value)));
  mute.addEventListener("click", () => setMuted(!state().muted));

  return {
    apply,
    louder: () => setVolume(state().volume + 0.1),
    quieter: () => setVolume(state().volume - 0.1),
    toggleMute: () => setMuted(!state().muted),
    /** Read once at startup; a person's change while reading takes precedence. */
    async load(/** @type {import("@endue-ai/plugin-sdk").PluginContext["bridge"]} */ store) {
      bridge = store;
      const result = await bridge
        .call("store.get", { key: KEY })
        .catch(() => ({ value: undefined }));
      const value = /** @type {{ volume?: unknown, muted?: unknown } | null} */ (result.value);
      if (changed || !value || typeof value !== "object") return;
      if (
        typeof value.volume === "number" &&
        Number.isFinite(value.volume) &&
        value.volume >= 0 &&
        value.volume <= 1
      )
        slider.value = String(value.volume);
      if (typeof value.muted === "boolean") mute.setAttribute("aria-pressed", String(value.muted));
      apply();
    },
  };
}
