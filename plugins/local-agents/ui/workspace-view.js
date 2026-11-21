// The plugin's saved conversations and optional native sources share a reader and a single composer.
import { defineElements, mergeSessionRows, sessionKey } from "@endue-ai/ui/elements";
import { button } from "./dom.js";

const savedKey = (id) => sessionKey(id, "plugin");
function savedTurns(chat) {
  return (chat?.messages ?? []).flatMap((m) => {
    if (m.role === "user") return [{ id: m.id, role: "user", text: m.text }];
    // Older saved messages have an answer and a tool list but no interleaving information.
    const parts = Array.isArray(m.parts)
      ? m.parts.filter((p) => p && typeof p.text === "string" && typeof p.role === "string")
      : [];
    const turns = (
      parts.length
        ? parts
        : [...(m.tools ?? []).map((t) => ({ role: "tool", name: t.name, text: t.detail }))]
    ).map((p, i) => ({ ...p, id: `${m.id}:${i}` }));
    if (m.text && !turns.some((t) => t.role === "assistant"))
      turns.push({ id: m.id, role: "assistant", text: m.text });
    if (m.error && !turns.some((t) => t.role === "failure" && t.text === m.error))
      turns.push({ id: `${m.id}:error`, role: "failure", text: m.error });
    return turns;
  });
}
export function createWorkspaceView(doc, act) {
  defineElements();
  const ws = doc.getElementById("workspace"),
    bar = doc.getElementById("chat-bar"),
    input = doc.getElementById("chat-input"),
    form = doc.getElementById("chat-form"),
    send = doc.getElementById("chat-send"),
    target = doc.getElementById("chat-target"),
    history = doc.querySelector("[data-native-history]");
  const drafts = new Map(),
    sending = new Set();
  let selected,
    native,
    model,
    key = "",
    timer;
  const submit = async () => {
    if (!selected || input.disabled) return;
    const to = key,
      id = selected.agent,
      text = input.value;
    if (native?.running || (!native && model.chat.running)) {
      await act(native ? "nativeStop" : "stopChat", native ? to : id);
      return;
    }
    if (!text.trim() || sending.has(to)) return;
    sending.add(to);
    try {
      const result = await (native ? act("nativeSend", to, text) : act("send", text, id));
      if (result && result.ending !== "failed") {
        if ((key === to || native?.draftFrom === to) && input.value === text) input.value = "";
        if (drafts.get(to) === text) drafts.delete(to);
      }
    } finally {
      sending.delete(to);
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });
  history.addEventListener("click", () => void act("nativeHistory"));
  return {
    render(vm) {
      model = vm;
      const saved = vm.conversations,
        n = vm.native,
        chat = vm.chat;
      native = n.selected ? n : undefined;
      selected = n.selected ?? saved.find((r) => r.agent === chat.agent);
      const next = selected?.key ?? "";
      if (next !== key) {
        if (native?.draftFrom === key) drafts.delete(key);
        else {
          if (key) drafts.set(key, input.value);
          input.value = drafts.get(next) ?? "";
        }
        key = next;
      }
      const rows = mergeSessionRows([...n.rows, ...saved]);
      const busy = native ? n.running : chat.running;
      const ready = !!selected && (native ? selected.status !== "missing" : chat.ready);
      input.disabled = !ready;
      send.disabled = !ready;
      send.textContent = busy ? "Stop" : "Send";
      target.textContent = [
        selected?.agentName,
        vm.access === "read-only" ? "Read only" : "Allow edits",
      ]
        .filter(Boolean)
        .join(" · ");
      history.disabled = n.loading;
      history.textContent = n.loading
        ? "Reading native history…"
        : n.enabled
          ? "Refresh native history"
          : "Open native history";
      const controls = [];
      if (native) {
        if (selected.nativeId && selected.sources.some((s) => s === "local" || s === "archive"))
          controls.push(
            button(doc, "Import session", act, "nativeImport", [
              selected.sources.includes("archive") ? "archive" : "local",
            ]),
          );
        controls.push(button(doc, "New conversation", act, "nativeFresh"));
      } else if (chat.agent) {
        controls.push(
          button(doc, `Model: ${chat.model || "default"}`, act, "pickModel"),
          button(doc, "New conversation", act, "newChat"),
        );
        const note = doc.createElement("small");
        note.className = "note";
        note.textContent = chat.resumes
          ? chat.session
            ? "Goes on in its own session"
            : "Opens its own session"
          : "Earlier turns go in each prompt";
        if (
          vm.access === "read-only" &&
          vm.agents.find((a) => a.id === chat.agent)?.guard === "none"
        )
          note.textContent += " · Read-only access cannot be enforced.";
        controls.push(note);
      }
      bar.replaceChildren(...controls);
      ws.view = {
        rows,
        selected,
        turns: native ? n.turns : savedTurns(chat),
        listNotice: n.problem,
        notice: native ? n.error || (n.reading ? "Reading the session…" : "") : undefined,
        older: native ? n.older : undefined,
        empty: !ready
          ? "Program unavailable. Saved messages can still be read."
          : "No messages yet.",
        onSelect: (row, source) => {
          if (source === "plugin" || !row.nativeId || row.key === savedKey(row.agent))
            void act("useAgent", row.agent);
          else {
            const original =
              source &&
              n.rows.find(
                (r) =>
                  r.nativeId === row.nativeId && r.agent === row.agent && r.sources[0] === source,
              );
            void act("nativeSelect", original || row);
          }
        },
        onQuery: (q) => {
          clearTimeout(timer);
          timer = setTimeout(() => void act("nativeSearch", q), 200);
        },
        pages: n.pages,
        onPage: (id) => void act("nativePage", id),
        onOlder: () => void act("nativeEarlier"),
        onRetry: native && n.error ? () => void act("nativeRetry") : undefined,
        onPreview: async (row) => {
          if (row.key === savedKey(row.agent))
            return savedTurns(await act("savedPreview", row.agent));
          const turns = await act("nativePreview", row);
          if (!turns) throw Error("Could not read the session.");
          return turns;
        },
      };
    },
    focus: () => input.focus(),
    key(action) {
      if (action === "focusComposer") {
        input.focus();
        return true;
      }
      if (native && action === "stopChat") {
        void act("nativeStop", key);
        return true;
      }
      if (native && action === "newChat") {
        void act("nativeFresh");
        return true;
      }
      if (native && action === "pickModel") return true;
      return false;
    },
  };
}
