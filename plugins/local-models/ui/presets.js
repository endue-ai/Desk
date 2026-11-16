// Presets: a system prompt and sampling settings under a name. A few come with the window; the
// person's own are kept in ~/.endue/local-models/presets.json. Choosing one fills the chat's
// settings, which can then be changed one by one; the defaults are what a new chat starts with.

/**
 * @typedef {import("./chat-types.js").Sampling} Sampling
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description?: string,
 *   system?: string,
 *   params: Sampling,
 *   think?: boolean,
 *   builtIn?: boolean,
 * }} Preset
 * @typedef {{ system?: string, params?: Sampling, preset?: string, think?: boolean }} Settings
 */

export const PRESETS_FILE = "~/.endue/local-models/presets.json";

/** @type {Preset[]} */
export const BUILT_IN = [
  {
    id: "balanced",
    name: "Balanced",
    description: "The server's own defaults: good for most questions",
    params: {},
    builtIn: true,
  },
  {
    id: "precise",
    name: "Precise",
    description: "Low temperature: facts, maths, code",
    params: { temperature: 0.2, topP: 0.85, repeatPenalty: 1.05 },
    builtIn: true,
  },
  {
    id: "creative",
    name: "Creative",
    description: "More varied words: stories, ideas, names",
    params: { temperature: 1.0, topP: 0.95, minP: 0.05 },
    builtIn: true,
  },
  {
    id: "coder",
    name: "Coding assistant",
    description: "Careful, complete code with short explanations",
    system:
      "You are an expert software engineer. Write correct, complete, idiomatic code. Prefer small, clear functions. Explain briefly what the code does and why, then show it in fenced blocks with the language named.",
    params: { temperature: 0.2, topP: 0.9 },
    builtIn: true,
  },
  {
    id: "concise",
    name: "Concise",
    description: "Short, direct answers",
    system:
      "Answer as briefly as you can while staying accurate. Use bullet points for lists. No preamble.",
    params: { temperature: 0.5 },
    builtIn: true,
  },
  {
    id: "editor",
    name: "Writing editor",
    description: "Improves your text and says what changed",
    system:
      "You are a careful editor. Improve the clarity, grammar and flow of the text you are given while keeping the author's voice and meaning. Return the edited text first, then a short list of the main changes.",
    params: { temperature: 0.4 },
    builtIn: true,
  },
];

/** A preset's settings as a chat's. @param {Preset} preset @returns {Settings} */
export const settingsOf = (preset) => ({
  preset: preset.id,
  system: preset.system ?? "",
  params: { ...preset.params },
  ...(preset.think === undefined ? {} : { think: preset.think }),
});

/** Whether a chat's settings still equal its preset's. @param {Settings} s @param {Preset | undefined} preset */
export function matches(s, preset) {
  if (!preset) return false;
  const a = JSON.stringify(clean(s.params ?? {}));
  const b = JSON.stringify(clean(preset.params));
  return a === b && (s.system ?? "").trim() === (preset.system ?? "").trim();
}

/** Sampling without the unset fields, its keys in order. @param {Sampling} p */
export function clean(p) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of Object.keys(p).sort()) {
    const v = /** @type {Record<string, unknown>} */ (p)[key];
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) out[key] = v;
  }
  return /** @type {Sampling} */ (out);
}

/** @param {{ readJson(path: string): Promise<any>, writeJson(path: string, v: unknown): Promise<unknown> }} store */
export function createPresets(store) {
  /** @type {Preset[]} */
  let mine = [];
  return {
    async load() {
      const saved = await store.readJson(PRESETS_FILE).catch(() => undefined);
      mine = Array.isArray(saved?.presets)
        ? saved.presets.filter((/** @type {any} */ p) => p?.id && p?.name)
        : [];
      return this.all();
    },
    /** @returns {Preset[]} */
    all: () => [...BUILT_IN, ...mine],
    /** @param {string | undefined} id */
    get: (id) => [...BUILT_IN, ...mine].find((p) => p.id === id),
    /** Keep a chat's settings as a preset of the person's. @param {string} name @param {Settings} s */
    async save(name, s) {
      const id = `mine-${
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || Date.now().toString(36)
      }`;
      /** @type {Preset} */
      const preset = {
        id,
        name: name.trim(),
        system: s.system?.trim() || undefined,
        params: clean(s.params ?? {}),
        ...(s.think === undefined ? {} : { think: s.think }),
      };
      mine = [...mine.filter((p) => p.id !== id), preset];
      await store.writeJson(PRESETS_FILE, { version: 1, presets: mine });
      return preset;
    },
    /** @param {string} id */
    async remove(id) {
      mine = mine.filter((p) => p.id !== id);
      await store.writeJson(PRESETS_FILE, { version: 1, presets: mine });
    },
  };
}

/** About how many tokens a text holds: a quarter of its characters, as most tokenizers come out. @param {string} text */
export const estimateTokens = (text) => Math.ceil(text.length / 4);
