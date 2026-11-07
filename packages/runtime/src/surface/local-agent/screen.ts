/**
 * A local agent's screen (ADR 0110): who it is and where it runs from, Import sessions and Import
 * archive, its sessions in three tabs (the program's own, its archive, the desk's copies) as the
 * core reads them from the program's files, the turns of the session picked, the work handed to it
 * and a work request. The search field and the request are built once; the rest redraws.
 */
import type {
  AgentsTranscriptResult,
  LocalAgentId,
  LocalAgentMessage,
  LocalAgentSession,
  LocalAgentSource,
} from "@endue-ai/bridge";
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { badgeOf, localName } from "../../system/local-ids";
import type { Mounted } from "../views";
import { mountComposer } from "./composer";
import { localText } from "./copy";
import { importLine, programLine, sessionMeta, TABS, tabLabel, titleOf, why } from "./model";
import { runsStrip } from "./runs";

/** Sessions read per page. */
const PAGE = 30;
/** Turns read of the session picked. */
const TURNS = 200;

interface ViewState {
  tab: LocalAgentSource;
  query: string;
  sessions: LocalAgentSession[];
  total: number;
  loading: boolean;
  error: string;
  selected: LocalAgentSession | undefined;
  transcript: AgentsTranscriptResult | undefined;
  reading: boolean;
  readError: string;
  importing: "local" | "archive" | null;
  notice: string;
}

export function localAgentBody(ctx: ShellCtx, agent: LocalAgentId): Mounted {
  const v: ViewState = {
    tab: "local",
    query: "",
    sessions: [],
    total: 0,
    loading: true,
    error: "",
    selected: undefined,
    transcript: undefined,
    reading: false,
    readError: "",
    importing: null,
    notice: "",
  };
  const lang = () => ctx.store.get().lang;
  const tr = (key: Parameters<typeof localText>[1], vars?: Record<string, string | number>) =>
    localText(lang(), key, vars);
  const local = () => ctx.bridge.localAgents;

  const head = h("div", { class: "local-head" });
  const noticeEl = h("p", { class: "local-notice", role: "status" });
  const tabs = h("div", { class: "segmented local-tabs", role: "tablist" });
  const search = h("input", {
    class: "input local-search",
    type: "search",
    "data-key": "local-search",
  });
  const list = h("ul", { class: "local-sessions", role: "listbox" });
  const detail = h("section", { class: "local-detail" });
  const runs = h("div", { class: "local-runs" });
  const notice = (line: string) => {
    v.notice = line;
    drawNotice();
  };
  const composer = mountComposer(
    ctx,
    agent,
    () => v.selected,
    notice,
    () => {
      reading += 1;
      v.selected = undefined;
      v.transcript = undefined;
      v.reading = false;
      v.readError = "";
      drawList();
      drawDetail();
      composer.update();
    },
  );
  const el = h(
    "div",
    { class: "local-view", "data-local-view": agent },
    head,
    noticeEl,
    h("div", { class: "local-bar" }, tabs, search),
    h("div", { class: "local-main" }, list, detail),
    runs,
    composer.el,
  );

  let token = 0;
  async function load(more = false): Promise<void> {
    const bridge = local();
    if (!bridge) return;
    const mine = ++token;
    v.loading = true;
    v.error = "";
    drawList();
    try {
      const page = await bridge.sessions(agent, {
        from: v.tab,
        ...(v.query ? { query: v.query } : {}),
        offset: more ? v.sessions.length : 0,
        limit: PAGE,
      });
      if (mine !== token) return;
      v.sessions = more ? [...v.sessions, ...page.sessions] : page.sessions;
      v.total = page.total;
    } catch (error) {
      if (mine !== token) return;
      v.error = why(error);
    }
    v.loading = false;
    drawList();
  }

  let reading = 0;
  async function pick(session: LocalAgentSession): Promise<void> {
    const bridge = local();
    if (!bridge) return;
    const mine = ++reading;
    v.selected = session;
    v.transcript = undefined;
    v.reading = true;
    v.readError = "";
    drawList();
    drawDetail();
    composer.update();
    try {
      const read = await bridge.transcript(agent, session.id, TURNS);
      if (mine !== reading) return;
      v.transcript = read;
      v.selected = read.session;
    } catch (error) {
      if (mine !== reading) return;
      v.readError = why(error);
    }
    v.reading = false;
    drawDetail();
  }

  async function importFrom(from: "local" | "archive"): Promise<void> {
    const bridge = local();
    if (!bridge || v.importing) return;
    v.importing = from;
    notice(tr("importing"));
    drawHead();
    try {
      const result = await bridge.import(agent, from);
      notice(importLine(lang(), result));
    } catch (error) {
      notice(tr("importFailed", { why: why(error) }));
    }
    v.importing = null;
    drawHead();
    void load();
  }

  const openSession = (sessionId: string) => {
    const found = v.sessions.find((s) => s.id === sessionId);
    if (found) void pick(found);
    else
      void local()
        ?.transcript(agent, sessionId, TURNS)
        .then(
          (read) => pick(read.session),
          (error: unknown) => notice(why(error)),
        );
  };

  function drawHead(): void {
    const s = ctx.store.get();
    const info = s.localAgents.find((a) => a.id === agent);
    const button = (from: "local" | "archive") =>
      h(
        "button",
        {
          class: "btn btn-xs btn-outline",
          type: "button",
          "data-key": `local-import-${from}`,
          "data-import": from,
          disabled: Boolean(v.importing) || !info,
          "aria-busy": String(v.importing === from),
          onClick: () => void importFrom(from),
        },
        tr(from === "local" ? "importSessions" : "importArchive"),
      );
    render(head, () => [
      h(
        "span",
        { class: "avatar agent-avatar local-badge", "aria-hidden": "true" },
        badgeOf(agent),
      ),
      h(
        "div",
        { class: "agent-who" },
        h("div", { class: "agent-name" }, localName(s.localAgents, agent)),
        h("div", { class: "agent-meta" }, info ? programLine(s.lang, info) : ""),
      ),
      h("div", { class: "local-actions" }, button("local"), button("archive")),
    ]);
    render(tabs, () =>
      TABS.map((tab) =>
        h(
          "button",
          {
            class: `segment${v.tab === tab ? " is-selected" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": String(v.tab === tab),
            "data-key": `local-tab-${tab}`,
            "data-tab": tab,
            onClick: () => {
              if (v.tab === tab) return;
              v.tab = tab;
              drawHead();
              void load();
            },
          },
          tabLabel(s.lang, info, tab),
        ),
      ),
    );
    tabs.setAttribute("aria-label", tr("tabs"));
    search.placeholder = tr("search");
    search.setAttribute("aria-label", tr("search"));
  }

  function drawNotice(): void {
    noticeEl.textContent = v.notice;
    noticeEl.hidden = !v.notice;
  }

  function drawList(): void {
    const now = ctx.wall();
    render(list, () => {
      if (v.error) return [h("li", { class: "local-empty" }, tr("readFailed", { why: v.error }))];
      if (!v.sessions.length)
        return [
          h(
            "li",
            { class: "local-empty pop-muted" },
            v.loading ? tr("reading") : tr(v.tab === "desk" ? "emptyDesk" : "empty"),
          ),
        ];
      const rows = v.sessions.map((session) =>
        h(
          "li",
          { role: "presentation" },
          h(
            "button",
            {
              class: `menu-item local-session${session.id === v.selected?.id ? " is-selected" : ""}`,
              type: "button",
              role: "option",
              "aria-selected": String(session.id === v.selected?.id),
              "data-key": `local-session-${session.id}`,
              "data-session": session.id,
              onClick: () => void pick(session),
            },
            h("span", { class: "local-session-title" }, titleOf(session)),
            h("span", { class: "local-session-meta" }, sessionMeta(lang(), session, now)),
            session.imported && v.tab !== "desk"
              ? h("span", { class: "tag local-in-desk" }, tr("inDesk"))
              : null,
          ),
        ),
      );
      const left = v.total - v.sessions.length;
      return [
        ...rows,
        left > 0
          ? h(
              "li",
              { role: "presentation" },
              h(
                "button",
                {
                  class: "btn btn-xs local-more",
                  type: "button",
                  "data-key": "local-more",
                  disabled: v.loading,
                  onClick: () => void load(true),
                },
                tr("more", { n: left }),
              ),
            )
          : null,
      ];
    });
  }

  const message = (m: LocalAgentMessage) =>
    h(
      "li",
      { class: `local-msg is-${m.role}` },
      h(
        "span",
        { class: "local-msg-who" },
        m.role === "user"
          ? tr("you")
          : m.role === "tool"
            ? tr("tool", { name: m.name ?? "" })
            : localName(ctx.store.get().localAgents, agent),
      ),
      h("p", { class: "local-msg-text" }, m.cut ? `${m.text}${tr("cut")}` : m.text),
    );

  function drawDetail(): void {
    const session = v.selected;
    render(detail, () => {
      if (!session) return [h("p", { class: "local-pick pop-muted" }, tr("pick"))];
      const read = v.transcript;
      return [
        h("h3", { class: "local-detail-title" }, titleOf(session)),
        h(
          "div",
          { class: "agent-meta local-detail-meta" },
          [session.cwd, session.branch, session.model].filter(Boolean).join(" · "),
          session.archived ? h("span", { class: "tag" }, tr("archived")) : null,
          session.imported ? h("span", { class: "tag local-in-desk" }, tr("inDesk")) : null,
        ),
        v.readError
          ? h("p", { class: "local-empty" }, tr("readFailed", { why: v.readError }))
          : !read
            ? h("p", { class: "local-empty pop-muted" }, tr("reading"))
            : h(
                "ol",
                { class: "local-transcript" },
                read.truncated
                  ? h("li", { class: "local-msg is-gap pop-muted" }, tr("truncated"))
                  : null,
                read.messages.map(message),
              ),
      ];
    });
  }

  function drawRuns(): void {
    render(runs, () => runsStrip(ctx, agent, openSession, notice));
  }

  let typing: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      v.query = search.value.trim();
      void load();
    }, 200);
  });

  drawHead();
  drawNotice();
  drawList();
  drawDetail();
  drawRuns();
  void load();

  const counts = ctx.store.watch(
    (s) => [s.lang, s.localAgents.find((a) => a.id === agent)],
    () => {
      drawHead();
      composer.update();
    },
  );
  const watchRuns = ctx.store.watch(
    (s) => [s.lang, s.erisRuns, s.localRuns.filter((r) => r.agent === agent)],
    () => drawRuns(),
  );
  // A run that ends in the session on screen added turns to it, and maybe a session to the list.
  const ended = ctx.store.watch(
    (s) =>
      s.localRuns
        .filter((r) => r.agent === agent && r.state !== "running")
        .map((r) => [r.runId, r.sessionId]),
    () => {
      const shown = v.selected;
      if (shown) void pick(shown);
      void load();
    },
  );
  return {
    el,
    off: () => {
      clearTimeout(typing);
      counts();
      watchRuns();
      ended();
    },
  };
}
