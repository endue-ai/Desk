// What Studio does for an endue agent, without a DOM: read its detail, save an inspector's fields,
// enable or disable it, delete it once its name is typed, open it on endue.ai (shell.open), and
// sign in to endue ID (desk.account.sign-in). Every change reads the detail again, as the web
// refetches after each mutation; there is no Save-all.

import { deleteConfirmed, NAME_MAX, webStudio } from "./studio.js";

/**
 * @typedef {import("./studio-api.js").StudioApi} StudioApi
 * @typedef {import("./studio-api.js").EndueDetail} EndueDetail
 * @typedef {{ loading: boolean, saving: boolean, deleting: boolean, error?: string }} DetailState
 */

/** shell.open for endue.ai's pages only. */
const LINKS = /** @type {const} */ ({ permission: "shell:open", schemes: ["https"] });

/**
 * @param {object} options
 * @param {any} options.ctx         the plugin context: bridge and commands
 * @param {StudioApi} options.studio
 * @param {(question: string) => Promise<boolean>} options.confirm
 * @param {() => void} options.redraw
 * @param {(text: string) => void} options.say
 * @param {() => void} options.gone  the agent on screen was deleted
 */
export function createStudioActions({ ctx, studio, confirm, redraw, say, gone }) {
  /** @type {Map<string, EndueDetail>} */
  const details = new Map();
  /** @type {Map<string, DetailState>} */
  const states = new Map();
  const stateOf = (/** @type {string} */ id) => {
    let state = states.get(id);
    if (!state) {
      state = { loading: false, saving: false, deleting: false };
      states.set(id, state);
    }
    return state;
  };
  const why = (/** @type {unknown} */ error) =>
    error instanceof Error ? error.message : String(error);

  /** Read one agent's detail; what was shown stays while it reads. */
  const read = async (/** @type {string} */ id) => {
    const state = stateOf(id);
    state.loading = !details.has(id);
    delete state.error;
    redraw();
    try {
      details.set(id, await studio.detail(id));
    } catch (error) {
      state.error = why(error);
    }
    state.loading = false;
    redraw();
  };

  /** Run a change, say how it went, and read the detail again. */
  const change = async (
    /** @type {string} */ id,
    /** @type {() => Promise<unknown>} */ run,
    /** @type {string} */ done,
  ) => {
    const state = stateOf(id);
    if (state.saving) return;
    state.saving = true;
    redraw();
    try {
      await run();
      say(done);
    } catch (error) {
      say(`That did not go through: ${why(error)}`);
    }
    state.saving = false;
    await read(id);
  };

  const open = async (/** @type {string} */ target) => {
    try {
      await ctx.bridge.call("shell.open", { target, scope: LINKS });
    } catch (error) {
      say(`Could not open ${target}: ${why(error)}`);
    }
  };

  return {
    read,
    detailOf: (/** @type {string} */ id) => details.get(id),
    /** @returns {DetailState} */
    stateOf: (/** @type {string} */ id) => ({ ...stateOf(id) }),
    say,
    /** Keep an inspector's fields. */
    save(
      /** @type {string} */ id,
      /** @type {string} */ facet,
      /** @type {Record<string, string>} */ values,
    ) {
      if (facet === "identity") {
        const name = (values.name ?? "").trim();
        if (!name || [...name].length > NAME_MAX)
          return Promise.resolve(say(`A name is 1 to ${NAME_MAX} characters.`));
        // At most eight language tags, each once; a role is kept only when it has words.
        const languages = [
          ...new Set(
            (values.languages ?? "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ].slice(0, 8);
        const role = (values.role ?? "").trim();
        const edit = {
          name,
          ...(role ? { role } : {}),
          description: (values.description ?? "").trim(),
          ...(languages.length ? { languages } : {}),
        };
        return change(id, () => studio.update(id, edit), "Saved.");
      }
      if (facet === "prompt") {
        const content = values.prompt ?? "";
        if (!content.trim()) return Promise.resolve(say("A prompt needs at least one word."));
        return change(id, () => studio.setPrompt(id, content), "The prompt is saved.");
      }
      if (facet === "settings") {
        const visibility = values.visibility ?? "private";
        const model = (values.model ?? "").trim();
        return change(id, () => studio.update(id, { visibility, model }), "Saved.");
      }
      return Promise.resolve();
    },
    /** Put an earlier prompt revision back in force. */
    restore: (/** @type {string} */ id, /** @type {number} */ rev) =>
      change(id, () => studio.restorePrompt(id, rev), `Revision ${rev} is in force again.`),
    /** An inspector's button: enable, disable, open on endue.ai, or start deleting. */
    async act(/** @type {string} */ id, /** @type {string} */ action) {
      if (action === "enable") return change(id, () => studio.setStatus(id, "active"), "Enabled.");
      if (action === "disable") {
        const question =
          "Disable this agent? It stops answering in every channel until you enable it.";
        if (!(await confirm(question))) return;
        return change(id, () => studio.setStatus(id, "inactive"), "Disabled.");
      }
      if (action === "open-web") return open(webStudio(id));
      if (action === "delete") {
        stateOf(id).deleting = true;
        redraw();
      }
    },
    cancelDelete(/** @type {string} */ id) {
      stateOf(id).deleting = false;
      redraw();
    },
    /** Delete the agent, once `typed` is its name exactly. */
    async confirmDelete(/** @type {string} */ id, /** @type {string} */ typed) {
      const name = details.get(id)?.agent.name ?? "";
      if (!deleteConfirmed(typed, name)) {
        say("Type the agent's name exactly to delete it.");
        return false;
      }
      const state = stateOf(id);
      state.saving = true;
      redraw();
      try {
        await studio.remove(id);
      } catch (error) {
        state.saving = false;
        say(`The agent was not deleted: ${why(error)}`);
        return false;
      }
      details.delete(id);
      states.delete(id);
      gone();
      say("The agent is deleted.");
      return true;
    },
    /** A web page in the person's browser: a link in an answer, the public catalog. */
    link: (/** @type {string} */ href) => open(href),
    /** An endue conversation on endue.ai: chatting with endue agents in the desk comes later. */
    openConversation: (/** @type {string} */ agentId, /** @type {string} */ conversationId) =>
      open(
        `https://endue.ai/agent/${encodeURIComponent(agentId)}/space/room/${encodeURIComponent(conversationId)}`,
      ),
    /** Start signing in to endue ID, as the account menu does. */
    async signIn() {
      try {
        await ctx.commands.run("desk.account.sign-in");
      } catch (error) {
        say(`Could not start signing in: ${why(error)}`);
      }
    },
  };
}
