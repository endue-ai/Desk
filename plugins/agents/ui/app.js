// The plugin's controller, without a DOM: it reads both sources, keeps them current from agents.run
// and agents.changed, holds where the person is (Home with its two tabs, one agent's Studio, New
// agent) and hands the view one model to draw. The view and the person's answers are handed in, so
// the tests drive it on the SDK's test host.

import { buildCards } from "./cards.js";
import { createFlow } from "./create.js";
import {
  agentChips,
  board,
  endueRows,
  filterCards,
  localRows,
  sourceChips,
  statusChips,
} from "./home.js";
import { createLocalApi } from "./local-api.js";
import { createLocalChat } from "./local-chat.js";
import { createReaders, foldRun, sidesOf } from "./sides.js";
import { cardFor, localFacets, localInspector } from "./studio.js";
import { createStudioActions } from "./studio-actions.js";
import { createStudioApi } from "./studio-api.js";
import { endueFacets, endueInspector } from "./studio-endue.js";

/**
 * @typedef {import("./cards.js").Card} Card
 * @typedef {import("./home.js").Filters} Filters
 * @typedef {import("./sides.js").Sides} Sides
 * @typedef {import("./local-chat.js").LocalChat} LocalChat
 * @typedef {{ page: "home" | "studio" | "create", tab: "agents" | "activity", key?: string, facet?: string }} Route
 * @typedef {object} HomeShown
 * @property {Filters} filters
 * @property {Card[]} cards          the cards the filters keep
 * @property {number} total
 * @property {import("./home.js").Chip[]} sourceChips
 * @property {import("./home.js").Chip[]} statusChips
 * @property {import("./home.js").BoardColumn[]} board
 * @property {ReturnType<typeof agentChips>} agentChips
 * @property {string[]} boardAgents
 * @property {number} rows
 * @property {number} now
 * @typedef {object} StudioShown
 * @property {Card} card
 * @property {import("./local-api.js").LocalAgent} [agent]
 * @property {import("./studio.js").Facet[]} facets
 * @property {string} [facet]
 * @property {import("./studio.js").Inspector} [inspector]
 * @property {import("./local-chat.js").ChatState & { runnable: boolean }} [chat]
 * @property {boolean} [loading]
 * @property {boolean} [saving]
 * @property {boolean} [deleting]
 * @property {string} [error]
 * @typedef {object} Shown
 * @property {Route} route
 * @property {string} notice
 * @property {ReturnType<typeof sidesOf>} sides
 * @property {{ endue: number, local: number, working: number }} counts
 * @property {HomeShown} [home]
 * @property {StudioShown} [studio]
 * @property {import("./create.js").CreateState} [create]
 * @typedef {{ show(shown: Shown): void }} View
 * @typedef {object} Deps
 * @property {(question: string) => Promise<boolean>} confirm
 * @property {(question: { prompt: string, folder: string, agent: string }) => Promise<boolean>} approve
 * @property {() => number} [now]
 */

/**
 * @param {import("@endue-ai/plugin-sdk").PluginContext | any} ctx
 * @param {View} view
 * @param {Deps} deps
 */
export function createApp(ctx, view, deps) {
  const now = deps.now ?? (() => Date.now());
  const local = createLocalApi(ctx);
  const studio = createStudioApi(ctx);
  /** @type {Route} */
  const route = { page: "home", tab: "agents", ...(ctx.state?.get?.()?.route ?? {}) };
  /** @type {Filters} */
  const filters = { source: "all", status: "all", query: "" };
  /** @type {string[]} */
  let boardAgents = [];
  /** @type {Sides} */
  const sides = {
    endue: { state: "loading", agents: [], conversations: [] },
    local: { state: "loading", agents: [], runs: [], sessions: {}, totals: {} },
  };
  /** @type {Map<string, LocalChat>} */
  const chats = new Map();
  let notice = "";
  /** @type {string | undefined} the endue agent whose Studio is open */
  let entered;

  const cards = () =>
    buildCards({
      // The list has no roles: an agent's facets, once read, say its role.
      endue: sides.endue.agents.map((a) => {
        const role = actions.detailOf(a.id)?.identity?.role;
        return role ? { ...a, role } : a;
      }),
      conversations: sides.endue.conversations,
      local: sides.local.agents,
      runs: sides.local.runs,
      lastSessions: Object.fromEntries(
        Object.entries(sides.local.sessions).map(([id, list]) => [id, list[0]?.updatedAt]),
      ),
    });

  const chatFor = (/** @type {string} */ agent) => {
    let chat = chats.get(agent);
    if (!chat) {
      chat = createLocalChat({
        api: local,
        agent,
        approve: deps.approve,
        changed: () => draw(),
        ended: () => void readSessions(agent),
      });
      chats.set(agent, chat);
    }
    return chat;
  };

  const actions = createStudioActions({
    ctx,
    studio,
    confirm: deps.confirm,
    redraw: () => draw(),
    say: (text) => {
      notice = text;
      draw();
    },
    gone: () => {
      go({ page: "home", tab: "agents" });
      void readEndue();
    },
  });

  const flow = createFlow({
    studio,
    open: (agentId) => {
      void readEndue().then(() => {
        go({ page: "studio", tab: route.tab, key: `endue:${agentId}` });
        const { warnings } = flow.state;
        if (warnings.length) actions.say(`Some settings did not apply: ${warnings.join(", ")}.`);
      });
    },
    changed: () => draw(),
  });

  /** Everything the view draws, for the page the person is on. @returns {Shown} */
  const shown = () => {
    const all = cards();
    const card = cardFor(all, route.key);
    const rows = [
      ...endueRows(sides.endue.conversations, all),
      ...localRows(sides.local.sessions, sides.local.runs, all),
    ];
    const base = {
      route: { ...route },
      notice,
      sides: sidesOf(sides),
      counts: {
        endue: all.filter((c) => c.source === "endue").length,
        local: all.filter((c) => c.source === "local").length,
        working: all.filter((c) => c.presence === "working").length,
      },
    };
    if (route.page === "create") return { ...base, create: flow.state };
    if (route.page === "studio" && card) return { ...base, studio: studioOf(card) };
    return {
      ...base,
      home: {
        filters: { ...filters },
        cards: filterCards(all, filters),
        total: all.length,
        sourceChips: sourceChips(all, filters),
        statusChips: statusChips(all, filters),
        board: board(rows, boardAgents, now()),
        agentChips: agentChips(rows, all),
        boardAgents: [...boardAgents],
        rows: rows.length,
        now: now(),
      },
    };
  };

  /** @returns {StudioShown} */
  const studioOf = (/** @type {Card} */ card) => {
    if (card.source === "endue") {
      const detail = actions.detailOf(card.id);
      const facet = route.facet;
      return {
        card,
        facets: endueFacets(detail),
        facet,
        inspector: detail && facet ? endueInspector(detail, facet) : undefined,
        ...actions.stateOf(card.id),
      };
    }
    const agent = sides.local.agents.find((a) => a.id === card.id);
    if (!agent) return { card, facets: [], facet: undefined };
    const chat = chatFor(agent.id).state;
    const facet = route.facet ?? "chat";
    const seen = {
      model: chat.model,
      folder: chat.folder,
      sessions: sides.local.sessions[agent.id] ?? [],
      total: sides.local.totals[agent.id],
    };
    return {
      card,
      agent,
      facets: localFacets(agent, seen),
      facet,
      inspector: facet === "chat" ? undefined : localInspector(agent, facet, seen),
      chat: { ...chat, runnable: card.runnable },
    };
  };

  const draw = () => view.show(shown());

  /** Go somewhere, keep it for a reload, and read what the page needs. */
  const go = (/** @type {Route} */ next) => {
    Object.assign(route, next);
    if (!next.key) delete route.key;
    if (!next.facet) delete route.facet;
    notice = "";
    ctx.state?.set?.({ route: { ...route } });
    // An endue agent's detail is read on the way in; its changes read it again themselves.
    const id = route.key?.startsWith("endue:") ? route.key.slice(6) : undefined;
    if (route.page === "studio" && id && (entered !== id || !actions.detailOf(id)))
      void actions.read(id);
    entered = route.page === "studio" ? id : undefined;
    if (route.page === "create" && flow.state.catalog.length === 0) void flow.browse();
    draw();
  };

  const { readLocal, readSessions, readEndue } = createReaders({ local, studio, sides, draw });

  const offLocal = local.onEvent((event) => {
    if (event.kind === "changed") {
      void readSessions(event.agent);
      return;
    }
    sides.local.runs = foldRun(sides.local.runs, event.data);
    if (["done", "failed", "stopped"].includes(event.data.kind))
      void readSessions(event.data.agent);
    else draw();
  });

  draw();
  const ready = Promise.all([readLocal(), readEndue()]).then(() => {
    if (route.page !== "home") go({ ...route });
  });

  return {
    ready,
    /** Read both sources again. */
    refresh() {
      local.again();
      return Promise.all([readLocal(), readEndue()]).then(() => undefined);
    },
    /** Read the endue side again: after signing in, say. */
    refreshEndue: () => readEndue(),
    get sides() {
      return sides;
    },
    /** Where the person is. @returns {Route} */
    get route() {
      return { ...route };
    },
    home: (/** @type {"agents" | "activity"} */ tab = route.tab) => go({ page: "home", tab }),
    create: () => go({ page: "create", tab: route.tab }),
    /** One agent's Studio, on a facet's inspector when one is named. */
    studio: (/** @type {string} */ key, facet = "") =>
      go({ page: "studio", tab: route.tab, key, ...(facet ? { facet } : {}) }),
    /** Open a facet's inspector, or close it with none. */
    facet: (facet = "") => go({ ...route, ...(facet ? { facet } : { facet: undefined }) }),
    /** Escape: close the inspector, then leave Studio or New agent for the Home. */
    back() {
      const closable = route.facet && !(route.key?.startsWith("local:") && route.facet === "chat");
      if (route.page === "studio" && closable) go({ ...route, facet: undefined });
      else if (route.page !== "home") go({ page: "home", tab: route.tab });
    },
    filter(/** @type {Partial<Filters>} */ change) {
      Object.assign(filters, change);
      draw();
    },
    boardAgent(/** @type {string} */ key) {
      boardAgents = boardAgents.includes(key)
        ? boardAgents.filter((k) => k !== key)
        : [...boardAgents, key];
      draw();
    },
    signIn: () => actions.signIn().then(() => readEndue()),
    flow,
    studioActions: actions,
    chat: (/** @type {string} */ agent) => chatFor(agent),
    /** Open a board row: a local session in its agent's chat, an endue conversation on endue.ai. */
    async openRow(/** @type {import("./home.js").Row} */ row) {
      if (row.source === "endue" && row.conversationId)
        return actions.openConversation(row.agentKey.slice(6), row.conversationId);
      const agent = row.agentKey.slice(6);
      go({ page: "studio", tab: route.tab, key: row.agentKey, facet: "chat" });
      if (row.sessionId) {
        const running = sides.local.runs.find((r) => r.runId === row.runId);
        await chatFor(agent).open(row.sessionId, running);
      }
    },
    /** Stop a local run from the board. */
    stopRun: (/** @type {string} */ runId) =>
      local.stop(runId).then(
        () => undefined,
        (error) => actions.say(`Could not stop: ${error.message}`),
      ),
    /** Use a local inspector's fields: the chat's model or folder, a session to continue. */
    local(
      /** @type {string} */ agent,
      /** @type {string} */ what,
      /** @type {Record<string, string>} */ values = {},
    ) {
      const chat = chatFor(agent);
      if (what === "model") chat.setModel(values.model ?? "");
      if (what === "folder") chat.setFolder(values.folder ?? "");
      if (what === "new-session") chat.fresh();
      if (what === "open" && values.id) {
        const running = sides.local.runs.find(
          (r) => r.sessionId === values.id && r.state === "running",
        );
        void chat.open(values.id, running);
      }
      go({ ...route, facet: what === "model" || what === "folder" ? route.facet : "chat" });
    },
    dispose() {
      offLocal();
      for (const chat of chats.values()) chat.dispose();
    },
  };
}

/** @typedef {ReturnType<typeof createApp>} App */
