/**
 * The work request at the bottom of a local agent's screen: what to hand over, continuing the
 * session on screen or in a new one in a folder, read-only unless the person allows changes. It is
 * built once, so what the person types survives every redraw around it; `update` follows the
 * selection and the language.
 */
import type { LocalAgentAccess, LocalAgentId, LocalAgentSession } from "@endue-ai/bridge";
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { applyRunStep } from "../../system/local-agents";
import { localText } from "./copy";
import { titleOf, why } from "./model";

export interface Composer {
  el: HTMLElement;
  /** Draw the labels again: the selection or the language changed. */
  update(): void;
}

export function mountComposer(
  ctx: ShellCtx,
  agent: LocalAgentId,
  selected: () => LocalAgentSession | undefined,
  notice: (line: string) => void,
  /** Let go of the session on screen, so the next request starts a new one. */
  startNew: () => void,
): Composer {
  let access: LocalAgentAccess = "read-only";
  let sending = false;
  const lang = () => ctx.store.get().lang;
  const runnable = () => Boolean(ctx.store.get().localAgents.find((a) => a.id === agent)?.program);
  const prompt = h("textarea", {
    class: "input local-prompt",
    rows: 2,
    "data-key": "local-prompt",
    "aria-label": localText(lang(), "promptNew"),
  });
  const folder = h("input", {
    class: "input local-folder",
    type: "text",
    value: "~",
    spellcheck: "false",
    "data-key": "local-folder",
  });
  const row = h("div", { class: "local-composer-row" });
  const hint = h("p", { class: "local-composer-hint pop-muted", role: "note" });
  const el = h(
    "form",
    { class: "local-composer", "data-local-composer": agent },
    prompt,
    row,
    hint,
  );

  const send = async () => {
    const text = prompt.value.trim();
    const local = ctx.bridge.localAgents;
    if (!text || sending || !local || !runnable()) return;
    const session = selected();
    sending = true;
    update();
    try {
      const run = await local.ask({
        agent,
        prompt: text,
        access,
        ...(session ? { sessionId: session.id } : {}),
        ...(!session && folder.value.trim() ? { cwd: folder.value.trim() } : {}),
      });
      prompt.value = "";
      ctx.store.set((s) => ({
        localRuns: applyRunStep(s.localRuns, {
          runId: run.runId,
          agent: run.agent,
          kind: "started",
          run,
        }),
      }));
    } catch (error) {
      notice(localText(lang(), "askFailed", { why: why(error) }));
    } finally {
      sending = false;
      update();
    }
  };

  el.addEventListener("submit", (event) => {
    event.preventDefault();
    void send();
  });
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });

  const segment = (value: LocalAgentAccess, label: string) =>
    h(
      "button",
      {
        class: `segment${access === value ? " is-selected" : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": String(access === value),
        "data-key": `local-access-${value}`,
        "data-access": value,
        onClick: () => {
          access = value;
          update();
        },
      },
      label,
    );

  function update(): void {
    const l = lang();
    const session = selected();
    prompt.setAttribute("aria-label", localText(l, session ? "promptContinue" : "promptNew"));
    prompt.placeholder = session
      ? localText(l, "continuing", { title: titleOf(session) })
      : localText(l, "promptNew");
    folder.setAttribute("aria-label", localText(l, "folder"));
    folder.title = localText(l, "folder");
    render(row, () => [
      h(
        "div",
        {
          class: "segmented local-access",
          role: "radiogroup",
          "aria-label": localText(l, "access"),
        },
        segment("read-only", localText(l, "readOnly")),
        segment("agent", localText(l, "mayChange")),
      ),
      session
        ? h(
            "button",
            {
              class: "btn btn-xs btn-outline local-new",
              type: "button",
              "data-key": "local-new",
              onClick: startNew,
            },
            localText(l, "newSession"),
          )
        : folder,
      h(
        "button",
        {
          class: "btn btn-primary local-send",
          type: "submit",
          "data-key": "local-send",
          // An agent the core found no program for is read here, never asked.
          disabled: sending || !ctx.bridge.localAgents || !runnable(),
        },
        localText(l, "send"),
      ),
    ]);
    const key = ctx.platform === "mac" ? "⌘↩" : "Ctrl+Enter";
    hint.textContent =
      access === "agent" ? localText(l, "mayChangeHint") : localText(l, "sendHint", { key });
  }

  update();
  return { el, update };
}
