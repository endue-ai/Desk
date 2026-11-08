// "New agent", without a DOM: the web's two modes. Find an agent for me searches the catalog
// (studio.catalog.recommend) and shows the catalog cards; Use starts an agent from one
// (studio.catalog.use). Build from scratch takes a name of 1–100 characters and a role. Either way
// the new agent opens in Studio.

import { NAME_MAX, ROLE_MAX } from "./studio.js";

/**
 * @typedef {import("./studio-api.js").StudioApi} StudioApi
 * @typedef {import("./studio-api.js").CatalogAgent} CatalogAgent
 * @typedef {object} CreateState
 * @property {"find" | "build"} mode
 * @property {"idle" | "browsing" | "finding" | "using" | "creating"} phase
 * @property {string} query
 * @property {CatalogAgent[]} catalog     every published catalog agent, before a search
 * @property {CatalogAgent[] | undefined} matches  after a search, the best first, with why
 * @property {"llm" | "keyword" | undefined} source
 * @property {string | undefined} selected  the catalog agent shown in the preview
 * @property {string | undefined} error
 * @property {string[]} warnings          what using a catalog agent could not apply
 * @property {{ name?: string, role?: string }} invalid
 */

export const QUERY_MAX = 500;

/**
 * Check Build from scratch's fields as the platform does: a name of 1–100 characters and a role.
 * @param {{ name: string, role: string }} fields
 */
export function validateBuild({ name, role }) {
  /** @type {{ name?: string, role?: string }} */
  const invalid = {};
  const n = [...name.trim()].length;
  if (n === 0) invalid.name = "Give it a name.";
  else if (n > NAME_MAX)
    invalid.name = `A name is at most ${NAME_MAX} characters (this one is ${n}).`;
  const r = [...role.trim()].length;
  if (r === 0) invalid.role = "Say what it does.";
  else if (r > ROLE_MAX) invalid.role = `A role is at most ${ROLE_MAX} characters.`;
  return { ok: !invalid.name && !invalid.role, invalid };
}

/**
 * @param {object} options
 * @param {StudioApi} options.studio
 * @param {(agentId: string) => void} options.open  show the new agent in Studio
 * @param {(state: CreateState) => void} [options.changed]
 * @param {string} [options.locale]
 */
export function createFlow({ studio, open, changed = () => {}, locale = "en" }) {
  /** @type {CreateState} */
  const state = {
    mode: "find",
    phase: "idle",
    query: "",
    catalog: [],
    matches: undefined,
    source: undefined,
    selected: undefined,
    error: undefined,
    warnings: [],
    invalid: {},
  };
  let generation = 0;
  const emit = () => changed({ ...state });
  const fail = (/** @type {unknown} */ error) => {
    state.error = error instanceof Error ? error.message : String(error);
    state.phase = "idle";
  };

  return {
    get state() {
      return state;
    },
    /** Switch between Find an agent for me and Build from scratch. */
    mode(/** @type {"find" | "build"} */ mode) {
      state.mode = mode;
      state.error = undefined;
      emit();
    },
    /** Read every published catalog agent, for the grid before a search. */
    async browse() {
      const mine = ++generation;
      state.phase = "browsing";
      state.error = undefined;
      emit();
      try {
        const catalog = await studio.catalog(locale);
        if (mine !== generation) return;
        state.catalog = catalog;
        state.phase = "idle";
      } catch (error) {
        if (mine !== generation) return;
        fail(error);
      }
      emit();
    },
    /** Find catalog agents for what the person wants done. */
    async find(/** @type {string} */ query) {
      const asked = query.trim().slice(0, QUERY_MAX);
      state.query = asked;
      if (!asked) {
        state.matches = undefined;
        state.source = undefined;
        emit();
        return;
      }
      const mine = ++generation;
      state.phase = "finding";
      state.error = undefined;
      state.selected = undefined;
      emit();
      try {
        const { matches, source } = await studio.recommend(asked, locale);
        if (mine !== generation) return;
        state.matches = matches;
        state.source = source;
        state.phase = "idle";
      } catch (error) {
        if (mine !== generation) return;
        fail(error);
      }
      emit();
    },
    /** Show one catalog agent's preview, or none. */
    select(/** @type {string | undefined} */ slug) {
      state.selected = slug;
      emit();
    },
    /** Start an agent from the catalog agent `slug`, then open it. */
    async use(/** @type {string} */ slug) {
      if (state.phase === "using" || state.phase === "creating") return;
      state.phase = "using";
      state.error = undefined;
      state.warnings = [];
      emit();
      try {
        const { agentId, warnings } = await studio.use(slug, locale);
        state.warnings = warnings;
        state.phase = "idle";
        emit();
        open(agentId);
      } catch (error) {
        fail(error);
        emit();
      }
    },
    /** Build an agent from a name and a role, then open it; invalid fields say why instead. */
    async build(/** @type {{ name: string, role: string }} */ fields) {
      if (state.phase === "using" || state.phase === "creating") return;
      const { ok, invalid } = validateBuild(fields);
      state.invalid = invalid;
      state.error = undefined;
      if (!ok) {
        emit();
        return;
      }
      state.phase = "creating";
      emit();
      try {
        const { agentId, warnings } = await studio.create({
          name: fields.name.trim(),
          role: fields.role.trim(),
          locale,
        });
        state.warnings = warnings;
        state.phase = "idle";
        emit();
        open(agentId);
      } catch (error) {
        fail(error);
        emit();
      }
    },
  };
}

/** @typedef {ReturnType<typeof createFlow>} CreateFlow */
