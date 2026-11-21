// The local Studio adapter supplies its selected agent, available sessions and confirmed writes.
import {
  defineElements,
  nativeSessionRow,
  nativeSessionTurns,
  sessionKey,
} from "@endue-ai/ui/elements";

/**
 * @typedef {object} ChatViewActions
 * @property {(text:string)=>Promise<boolean>} send
 * @property {()=>void} stop
 * @property {(access:"read-only"|"agent")=>void} access
 * @property {()=>void} fresh
 * @property {(id:string)=>void} [open]
 * @property {()=>void} [older]
 * @property {()=>void} [more]
 * @property {(id:string)=>Promise<import("@endue-ai/ui/elements").SessionRead>} [preview]
 * @property {(href:string)=>void} link
 */
export function createChatView(doc, actions) {
  defineElements();
  const pick = (id) => doc.getElementById(id);
  const panel = pick("chat"),
    reader = pick("studio-reader"),
    input = pick("chat-input"),
    send = pick("chat-send"),
    stop = pick("chat-stop"),
    access = pick("chat-access");
  let key = "",
    selection = "";
  const drafts = new Map();
  const submit = async () => {
    if (input.disabled || send.disabled) return;
    const target = key,
      selectedRun = selection,
      text = input.value;
    if (!text.trim()) return;
    if (await actions.send(text)) {
      if (selection === selectedRun && input.value === text) input.value = "";
      if (drafts.get(target) === text) drafts.delete(target);
    }
  };
  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });
  stop.addEventListener("click", () => actions.stop());
  pick("chat-new").addEventListener("click", () => actions.fresh());
  for (const choice of access.querySelectorAll("[data-access]"))
    choice.addEventListener("click", () => actions.access(choice.dataset.access));
  reader.addEventListener("desk-link", (e) => actions.link(e.detail.href));
  return {
    show(s) {
      const chat = s.chat;
      panel.hidden = !chat || s.facet !== "chat";
      if (!chat || panel.hidden) return;
      const rows = (s.sessions ?? []).map((session) => nativeSessionRow(session, s.card.name));
      const selected = rows.find((r) => r.nativeId === chat.sessionId) ?? {
        key: sessionKey(chat.agent, "native", chat.sessionId ?? ""),
        nativeId: chat.sessionId,
        agent: chat.agent,
        agentName: s.card.name,
        sources: ["local"],
        title: chat.title || `New session with ${s.card.name}`,
      };
      if (!chat.runnable) selected.status = "missing";
      else if (chat.phase === "running" || chat.phase === "stopping") selected.status = "working";
      else if (chat.outcome) selected.status = chat.outcome;
      const turns = chat.messages.flatMap((m) => {
        if (m.role === "plan")
          return [{ id: m.id, role: "plan", name: m.name, text: m.text, steps: m.steps }];
        if (m.role === "tool")
          return [
            {
              id: m.id,
              role: "tool",
              name: m.text,
              text: m.tools[0]?.detail ?? "",
              cut: m.cut,
              at: m.at,
            },
          ];
        const parts = m.parts?.length
          ? m.parts
          : [
              ...(m.tools ?? []).map((t) => ({ role: "tool", name: t.name, text: t.detail })),
              ...(m.text ? [{ role: m.role, text: m.text, cut: m.cut, at: m.at }] : []),
            ];
        const result = parts.map((p, i) => ({ ...p, id: `${m.id}:${i}` }));
        if (m.error) result.push({ id: `${m.id}:error`, role: "failure", text: m.error });
        return result;
      });
      if (selected.key !== key) {
        if (key) drafts.set(key, input.value);
        const assigned = selection === JSON.stringify([chat.agent, chat.selection]);
        key = selected.key;
        if (!assigned) input.value = drafts.get(key) ?? "";
      }
      selection = JSON.stringify([chat.agent, chat.selection]);
      reader.view = {
        rows,
        selected,
        turns,
        onNew: actions.fresh,
        older: chat.older,
        notice: chat.error || (chat.phase === "loading" ? "Reading the session…" : undefined),
        onOlder: () => actions.older?.(),
        pages:
          (s.sessionTotal ?? 0) > rows.length
            ? [{ id: "local", label: `Show more (${s.sessionTotal - rows.length})` }]
            : [],
        onPage: () => actions.more?.(),
        onSelect: (r) => actions.open?.(r.nativeId),
        onPreview: async (r) => nativeSessionTurns((await actions.preview(r.nativeId)).messages),
        onRetry: chat.error && chat.sessionId ? () => actions.open?.(chat.sessionId) : undefined,
        empty: chat.runnable
          ? "No messages yet."
          : "Program unavailable. Saved conversations can still be read.",
      };
      input.disabled = !chat.runnable;
      input.placeholder = chat.sessionId
        ? `Continue with ${s.card.name}`
        : `Message ${s.card.name}`;
      send.disabled = chat.phase !== "idle" || !chat.runnable;
      send.textContent = chat.phase === "sending" ? "Sending…" : "Send";
      stop.hidden = !(chat.phase === "running" || chat.phase === "stopping");
      stop.disabled = chat.phase === "stopping";
      send.hidden = !stop.hidden;
      pick("chat-new").hidden = !chat.sessionId;
      for (const choice of access.querySelectorAll("[data-access]"))
        choice.setAttribute("aria-checked", String(choice.dataset.access === chat.access));
      pick("chat-hint").textContent =
        chat.access === "agent"
          ? "Each message asks for permission to change files."
          : `${s.card.name} · Read only`;
    },
    focus: () => input.focus(),
  };
}
