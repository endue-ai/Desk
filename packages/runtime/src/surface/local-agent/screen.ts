import type { LocalAgentId, LocalAgentSession, LocalAgentSource } from "@endue-ai/bridge";
import {
  appendSessionRun,
  defineElements,
  nativeSessionRow,
  nativeSessionTurns,
  SessionHistory,
  type SessionRow,
  type SessionTurn,
  sessionKey,
  sessionTool,
  workspacePath,
} from "@endue-ai/ui/elements";
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { localMark } from "../../shell/marks";
import { localName } from "../../system/local-ids";
import type { Mounted } from "../views";
import { mountComposer } from "./composer";
import { localText } from "./copy";
import { importLine, programLine, TABS, tabLabel, why } from "./model";
import { runsStrip } from "./runs";

const PAGE = 30;
export function localAgentBody(ctx: ShellCtx, agent: LocalAgentId): Mounted {
  defineElements();
  const v = {
    tab: "local" as LocalAgentSource,
    query: "",
    sessions: [] as LocalAgentSession[],
    total: 0,
    loading: false,
    error: "",
    selected: undefined as SessionRow | undefined,
    source: "local" as LocalAgentSource,
    importing: null as "local" | "archive" | null,
    notice: "",
  };
  const reader = document.createElement("desk-agent-session");
  const lang = () => ctx.store.get().lang;
  const tr = (key: Parameters<typeof localText>[1], vars?: Record<string, string | number>) =>
    localText(lang(), key, vars);
  const local = () => ctx.bridge.localAgents;
  const head = h("div", { class: "local-head" });
  const tabs = h("div", { class: "segmented local-tabs", role: "tablist", slot: "navigation" });
  const noticeEl = h("p", { class: "local-notice", role: "status" });
  const runs = h("div", { class: "local-runs" });
  const notice = (line: string) => {
    v.notice = line;
    noticeEl.textContent = line;
    noticeEl.hidden = !line;
  };
  const history = new SessionHistory(draw);
  let token = 0,
    selection = 0,
    disposed = false;
  let following: string | undefined;
  let typing: ReturnType<typeof setTimeout> | undefined;
  const live = new Map<string, SessionTurn[]>();
  const target = () => v.selected?.key ?? sessionKey(agent, "new", String(selection));
  const fresh = () => {
    selection++;
    following = undefined;
    v.selected = undefined;
    history.clear();
    composer.update();
    draw();
  };
  const composer = mountComposer(
    ctx,
    agent,
    () => v.selected,
    notice,
    fresh,
    target,
    (run) => {
      if (disposed) return;
      following = run.runId;
      v.source = "local";
      v.selected = {
        key: target(),
        title: run.prompt,
        agent,
        agentName: localName(ctx.store.get().localAgents, agent),
        workspace: workspacePath(run.cwd),
        sources: ["local"],
      };
      if (!live.has(run.runId)) live.set(run.runId, []);
      draw();
      if (run.state !== "running") void load();
    },
  );
  composer.el.slot = "composer";
  reader.append(tabs, composer.el);
  const el = h(
    "div",
    { class: "local-view", "data-local-view": agent },
    head,
    noticeEl,
    reader,
    runs,
  );
  function sessionRow(s: LocalAgentSession, source: LocalAgentSource): SessionRow {
    const state = ctx.store.get(),
      info = state.localAgents.find((a) => a.id === agent);
    const row = nativeSessionRow(s, localName(state.localAgents, agent), source);
    const run = state.localRuns.find((r) => r.agent === agent && r.sessionId === s.id);
    if (!info?.program) row.status = "missing";
    else if (run) row.status = run.state === "running" ? "working" : run.state;
    return row;
  }
  function draw() {
    if (disposed) return;
    const bridge = local(),
      state = ctx.store.get(),
      current = following && state.localRuns.find((r) => r.runId === following);
    const shown = v.selected;
    if (current && current.sessionId && shown && !shown.nativeId) {
      shown.nativeId = current.sessionId;
      shown.key = sessionKey(agent, "local", current.sessionId);
      composer.update(true);
    }
    const row = history.result
      ? sessionRow(history.result.session, v.source)
      : shown && { ...shown };
    if (row && current) row.status = current.state === "running" ? "working" : current.state;
    const turns = nativeSessionTurns(history.result?.messages ?? []);
    for (const r of [...state.localRuns].reverse()) {
      if (
        r.agent !== agent ||
        !(r.runId === following || (shown?.nativeId && r.sessionId === shown.nativeId))
      )
        continue;
      if (r.state === "running" || r.state === "failed" || live.has(r.runId))
        appendSessionRun(turns, r, live.get(r.runId) ?? []);
    }
    reader.view = {
      lang: lang(),
      now: ctx.wall(),
      rows: v.sessions.map((s) => sessionRow(s, v.tab)),
      selected: row,
      turns,
      onNew: fresh,
      listNotice: v.error
        ? tr("readFailed", { why: v.error })
        : !v.sessions.length
          ? v.loading
            ? tr("reading")
            : v.query
              ? ""
              : tr(v.tab === "desk" ? "emptyDesk" : "empty")
          : "",
      notice: history.error
        ? tr("readFailed", { why: history.error })
        : history.loading && !history.result
          ? tr("reading")
          : undefined,
      empty: shown ? undefined : tr("pick"),
      older: history.older,
      onOlder: () => void history.more(),
      onRetry: history.error ? () => void history.refresh() : undefined,
      onRetryList: v.error ? () => void load() : undefined,
      pages:
        v.total > v.sessions.length
          ? [{ id: v.tab, label: tr("more", { n: v.total - v.sessions.length }) }]
          : [],
      onPage: () => {
        if (!v.loading) void load(true);
      },
      onSelect: (r) => {
        const s = v.sessions.find((s) => s.id === r.nativeId);
        if (s) pick(s);
      },
      onQuery: (q) => {
        clearTimeout(typing);
        v.query = q;
        typing = setTimeout(() => void load(), 200);
      },
      onPreview: async (r) =>
        r.nativeId && bridge
          ? nativeSessionTurns((await bridge.transcript(agent, r.nativeId, 200)).messages)
          : [],
    };
  }
  async function load(more = false) {
    const bridge = local();
    if (!bridge) return;
    const mine = ++token;
    v.loading = true;
    v.error = "";
    draw();
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
      const id = v.selected?.nativeId;
      if (
        following &&
        id &&
        !history.result &&
        !history.loading &&
        v.sessions.some((s) => s.id === id)
      )
        void history.open((limit) => bridge.transcript(agent, id, limit));
    } catch (err) {
      if (mine !== token) return;
      v.error = why(lang(), err);
    }
    v.loading = false;
    draw();
  }
  function pick(session: LocalAgentSession, source = v.tab) {
    const bridge = local();
    if (!bridge) return;
    selection++;
    following = undefined;
    v.selected = sessionRow(session, source);
    v.source = source;
    composer.update();
    void history.open((limit) => bridge.transcript(agent, session.id, limit));
  }
  async function openSession(id: string) {
    const found = v.sessions.find((s) => s.id === id);
    if (found) {
      pick(found);
      return;
    }
    const mine = ++selection;
    try {
      const result = await local()?.transcript(agent, id, 200);
      if (mine === selection && result)
        pick(result.session, result.session.archived ? "archive" : "local");
    } catch (err) {
      if (mine === selection) notice(why(lang(), err));
    }
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
      notice(tr("importFailed", { why: why(lang(), error) }));
    }
    v.importing = null;
    drawHead();
    void load();
  }

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
        localMark(agent),
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
              v.sessions = [];
              v.total = 0;
              drawHead();
              void load();
            },
          },
          tabLabel(s.lang, info, tab),
        ),
      ),
    );
    tabs.setAttribute("aria-label", tr("tabs"));
  }
  function drawRuns() {
    render(runs, () => runsStrip(ctx, agent, (id) => void openSession(id), notice));
  }
  const counts = ctx.store.watch(
    (s) => [s.lang, s.localAgents.find((a) => a.id === agent)],
    () => {
      drawHead();
      composer.update();
      draw();
    },
  );
  const watchRuns = ctx.store.watch(
    (s) => [s.lang, s.erisRuns, s.localRuns.filter((r) => r.agent === agent)],
    () => {
      drawRuns();
      composer.update();
      draw();
    },
  );
  const off = local()?.onEvent((event) => {
    if (event.kind !== "run" || event.data.agent !== agent) return;
    const e = event.data;
    if (e.kind === "tool" || e.kind === "text") {
      const parts = live.get(e.runId) ?? [];
      parts.push({
        id: `${e.runId}:${parts.length}`,
        ...(e.kind === "tool"
          ? sessionTool(e.tool ?? "Tool", e.detail ?? "")
          : { role: "assistant", text: e.text ?? "" }),
      });
      live.set(e.runId, parts);
      draw();
    } else if (["done", "failed", "stopped"].includes(e.kind)) {
      if (v.selected?.nativeId && e.run?.sessionId === v.selected.nativeId) void history.refresh();
      if (live.size > 50) {
        const retained = new Set(ctx.store.get().localRuns.map((r) => r.runId));
        for (const id of live.keys()) if (!retained.has(id)) live.delete(id);
      }
      void load();
    }
  });
  drawHead();
  notice("");
  drawRuns();
  draw();
  void load();
  return {
    el,
    off: () => {
      disposed = true;
      token++;
      selection++;
      history.clear();
      clearTimeout(typing);
      counts();
      watchRuns();
      off?.();
    },
  };
}
