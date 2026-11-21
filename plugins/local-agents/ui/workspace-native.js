// Optional native history. Only an explicit visit opens this source and obtains its own agent list.
import {
  nativeSessionRow,
  nativeSessionTurns,
  SessionHistory,
  sessionKey,
} from "@endue-ai/ui/elements";

const scope = { permission: "agents:manage" };
const sources = ["local", "archive", "desk"];
const why = (error) =>
  error?.code === "permission_denied"
    ? "Native history access was declined."
    : error?.message || "Native history is unavailable.";
export function createNativeHistory(bridge, changed) {
  let agents = [],
    pages = [],
    problem = "",
    loading = false,
    enabled = false,
    selected,
    latest = 0,
    listing = 0,
    nextDraft = 0,
    query = "";
  const history = new SessionHistory(changed);
  const active = new Map();
  const sending = new Set();
  const call = (method, params = {}) => bridge.call(method, { ...params, scope });
  const listed = (id) => agents.some((a) => a.id === id);
  const read = async (row, limit) => {
    if (!listed(row.agent) || !row.nativeId) throw Error("This history source is unavailable.");
    return call("agents.transcript", { agent: row.agent, sessionId: row.nativeId, limit });
  };
  const page = async (p, more = false) => {
    if (p.busy || !listed(p.agent)) return;
    const version = listing;
    p.busy = true;
    p.error = "";
    try {
      const result = await call("agents.sessions", {
        agent: p.agent,
        from: p.source,
        offset: more ? p.rows.length : 0,
        limit: 30,
        ...(query ? { query } : {}),
      });
      if (version !== listing) return;
      const name = agents.find((a) => a.id === p.agent)?.name ?? p.agent;
      const rows = result.sessions
        .filter((s) => s.agent === p.agent)
        .map((s) => nativeSessionRow(s, name, p.source));
      p.rows = more ? [...p.rows, ...rows] : rows;
      p.total = result.total;
    } catch (err) {
      if (version === listing) p.error = why(err);
    } finally {
      p.busy = false;
      if (version === listing) changed();
    }
  };
  const refresh = async () => {
    listing++;
    pages = agents.flatMap((a) =>
      sources.map((source) => ({
        id: JSON.stringify([a.id, source]),
        source,
        agent: a.id,
        rows: [],
        total: 0,
        busy: false,
        error: "",
      })),
    );
    await Promise.all(pages.map((p) => page(p)));
  };
  const open = async () => {
    if (loading) return;
    const gen = ++latest;
    loading = true;
    problem = "";
    changed();
    try {
      let result;
      try {
        result = await call("agents.list");
      } catch (error) {
        if (error?.code !== "permission_denied") throw error;
        const decision = await bridge.call("perm.request", {
          permission: scope,
          reason: "Read local agent sessions and continue a selected conversation.",
        });
        if (!decision.granted) throw error;
        result = await call("agents.list");
      }
      if (gen !== latest) return;
      agents = result.agents;
      enabled = true;
      await refresh();
      if (agents.some((a) => a.running > 0)) {
        const { runs } = await call("agents.runs");
        if (gen !== latest) return;
        for (const r of runs)
          if (listed(r.agent) && !active.has(r.runId)) active.set(r.runId, { ...r, parts: [] });
      }
      if (!agents.length) problem = "No native history sources are available.";
    } catch (err) {
      if (gen === latest) {
        enabled = false;
        agents = [];
        pages = [];
        selected = undefined;
        history.clear();
        problem = why(err);
      }
    } finally {
      if (gen === latest) {
        loading = false;
        changed();
      }
    }
  };
  const select = (row) => {
    if (!row || !listed(row.agent)) return;
    selected = row;
    return history.open((limit) => read(row, limit));
  };
  const fresh = () => {
    const agent = agents.find((a) => a.id === selected?.agent);
    if (!agent) return;
    selected = {
      key: sessionKey(agent.id, "new", String(++nextDraft)),
      agent: agent.id,
      agentName: agent.name,
      title: "New conversation",
      sources: ["local"],
      status: agent.program ? undefined : "missing",
    };
    history.clear();
    changed();
  };
  const matches = (run, row) =>
    row &&
    run.agent === row.agent &&
    (run.key === row.key || (!!row.nativeId && run.sessionId === row.nativeId));
  const ongoing = (row) =>
    [...active.values()].find((r) => r.state === "running" && matches(r, row));
  const finish = (r) => {
    if (!matches(r, selected)) return;
    if (!selected.nativeId && r.sessionId) {
      const known = pages.flatMap((p) => p.rows).find((row) => matches(r, row));
      void select(
        known ?? {
          ...selected,
          nativeId: r.sessionId,
          key: sessionKey(r.agent, "local", r.sessionId),
          title: r.prompt || selected.title,
        },
      );
    } else if (selected.nativeId) void history.refresh();
  };
  const off = bridge.onEvent((event) => {
    if (!enabled) return;
    if (event.event === "agents.changed" && listed(event.data.agent)) {
      void refresh();
      return;
    }
    if (event.event !== "agents.run" || !listed(event.data.agent)) return;
    const d = event.data,
      prev = active.get(d.runId);
    const r = d.run ? { ...prev, ...d.run, parts: prev?.parts ?? [] } : prev;
    if (!r) return;
    if (d.sessionId) r.sessionId = d.sessionId;
    if (d.kind === "tool" || d.kind === "text")
      r.parts.push({
        id: `${d.runId}:${r.parts.length}`,
        role: d.kind === "tool" ? "tool" : "assistant",
        text: d.kind === "tool" ? (d.detail ?? "") : (d.text ?? ""),
        name: d.tool,
      });
    active.set(d.runId, r);
    if (["done", "stopped", "failed"].includes(d.kind)) {
      finish(r);
      void refresh();
    }
    if (active.size > 50) {
      const done = [...active.values()].find((x) => x.state !== "running");
      if (done) active.delete(done.runId);
    }
    changed();
  });
  return {
    open,
    select,
    fresh,
    more: () => history.more(),
    retry: () => history.refresh(),
    clear() {
      selected = undefined;
      history.clear();
    },
    search(text) {
      if (enabled && text !== query) {
        query = text;
        return refresh();
      }
    },
    page(id) {
      const p = pages.find((p) => p.id === id);
      if (p) return page(p, true);
    },
    preview: async (row) => nativeSessionTurns((await read(row, 200)).messages),
    async send(key, prompt, access, approve) {
      const row = selected;
      if (
        !row ||
        row.key !== key ||
        !agents.find((a) => a.id === row.agent)?.program ||
        ongoing(row) ||
        sending.has(key)
      )
        return false;
      sending.add(key);
      try {
        if (access === "agent" && !(await approve())) return false;
        if (selected !== row) return false;
        const { run } = await call("agents.ask", {
          agent: row.agent,
          ...(row.nativeId ? { sessionId: row.nativeId } : {}),
          prompt,
          access,
        });
        const current = { ...run, parts: [], ...active.get(run.runId), key };
        active.set(run.runId, current);
        if (current.state !== "running") finish(current);
        changed();
        return true;
      } finally {
        sending.delete(key);
      }
    },
    stop(key) {
      const r = selected?.key === key && ongoing(selected);
      if (r) return call("agents.stop", { runId: r.runId });
    },
    async import(from) {
      const row = selected;
      if (row?.nativeId && listed(row.agent) && ["archive", "local"].includes(from)) {
        await call("agents.import", { agent: row.agent, from, sessionIds: [row.nativeId] });
        await refresh();
      }
    },
    dispose() {
      latest++;
      listing++;
      history.clear();
      off();
    },
    snapshot() {
      const rows = pages
        .flatMap((p) => p.rows)
        .map((row) => {
          const run = [...active.values()].findLast(
            (r) => r.agent === row.agent && r.sessionId === row.nativeId,
          );
          return {
            ...row,
            status: !agents.find((a) => a.id === row.agent)?.program
              ? "missing"
              : run?.state === "running"
                ? "working"
                : run?.state,
          };
        });
      const run = ongoing(selected);
      const recent = [...active.values()].findLast((r) => matches(r, selected));
      const turns = nativeSessionTurns(history.result?.messages ?? []);
      if (recent && (run || !turns.length)) {
        if (recent.prompt && turns.findLast((m) => m.role === "user")?.text !== recent.prompt)
          turns.push({ id: recent.runId + ":prompt", role: "user", text: recent.prompt });
        turns.push(...recent.parts);
        if (recent.text && !recent.parts.some((p) => p.role === "assistant"))
          turns.push({ id: recent.runId + ":text", role: "assistant", text: recent.text });
      }
      if (recent?.state === "failed" && recent.error)
        turns.push({ id: recent.runId, role: "failure", text: recent.error });
      return {
        rows,
        selected: selected ? (rows.find((r) => r.key === selected.key) ?? selected) : undefined,
        turns,
        older: history.older,
        error: history.error,
        reading: history.loading,
        enabled,
        loading,
        problem: problem || pages.find((p) => p.error)?.error || "",
        running: !!run,
        pages: pages
          .filter((p) => p.error || p.rows.length < p.total)
          .map((p) => ({
            id: p.id,
            label: `${p.error ? "Retry" : "Show more"} · ${agents.find((a) => a.id === p.agent)?.name ?? p.agent} · ${p.source}`,
          })),
      };
    },
  };
}
