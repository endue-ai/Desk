import { type SessionCopy, sessionCopy } from "./agent-session-copy";
import { action, node } from "./agent-session-dom";
import type { SessionTurn, SessionView } from "./agent-session-model";

function completeRecord(text: string): boolean {
  const value = text.trim();
  if (/^<([a-z][\w.-]*)\b[^>]*>[\s\S]*<\/\1>$/i.test(value)) return true;
  if (!value.startsWith("{") && !value.startsWith("[")) return false;
  try {
    return typeof JSON.parse(value) === "object";
  } catch {
    return false;
  }
}
function block(turns: SessionTurn[], v: SessionView, c: SessionCopy): HTMLElement {
  const t = turns[0]!;
  const el = node("article", "turn");
  el.dataset.turn = t.id;
  el.dataset.role = t.role;
  if (t.role === "tool") {
    const fold = node("details", "calls");
    fold.append(node("summary", "", turns.length === 1 ? c.oneTool : `${turns.length} ${c.tools}`));
    for (const item of turns) {
      const entry = node("div", "tool-line");
      entry.append(node("strong", "", item.name || c.tool), node("pre", "", item.text));
      if (item.cut) entry.append(node("small", "muted", c.cut));
      fold.append(entry);
    }
    el.append(fold);
    return el;
  }
  const author =
    t.role === "user"
      ? c.you
      : t.role === "assistant"
        ? v.selected?.agentName || c.agent
        : t.name ||
          (
            {
              failure: c.failed,
              notification: c.notification,
              plan: c.plan,
              excerpt: t.proposed ? c.proposed : c.excerpt,
              record: c.record,
            } as const
          )[t.role];
  el.append(node("strong", "author", author));
  if (t.at) {
    const at = node("time", "muted", t.at);
    at.dateTime = t.at;
    el.append(at);
  }
  if (t.role === "plan" && Array.isArray(t.steps)) {
    const steps = node("ol", "steps");
    el.append(
      node(
        "small",
        "muted",
        `${t.steps.filter((s) => s.state === "done" || s.state === "completed").length}/${t.steps.length}`,
      ),
    );
    for (const s of t.steps) steps.append(node("li", "", `${s.state} · ${s.text}`));
    el.append(steps);
  } else if (
    t.role === "record" ||
    (!t.cut && (t.role === "user" || t.role === "assistant") && completeRecord(t.text))
  ) {
    const reveal = node("details", "original");
    reveal.append(node("summary", "", c.record), node("pre", "", t.text));
    el.append(reveal);
  } else if (t.role === "assistant") {
    const md = node("desk-markdown");
    md.source = t.text;
    el.append(md);
  } else {
    if (t.role === "excerpt" && t.name)
      el.append(node("small", "muted", t.proposed ? c.proposed : c.excerpt));
    el.append(t.role === "excerpt" ? node("pre", "", t.text) : node("p", "plain", t.text));
  }
  if (t.cut) el.append(node("small", "muted", c.cut));
  return el;
}
export class Transcript {
  readonly log = node("div", "transcript");
  readonly jump = action("", () => this.bottom(), "jump");
  #items = node("div", "turns");
  #before = node("div", "earlier");
  #note = node("div", "read-note");
  #cells = new Map<string, { sig: string; el: HTMLElement }>();
  #key?: string;
  #positions = new Map<string, number>();
  #following = true;
  #restore?: number;
  constructor() {
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "off");
    this.log.tabIndex = 0;
    this.log.append(this.#before, this.#items, this.#note);
    this.jump.hidden = true;
    this.log.addEventListener("scroll", () => {
      if (this.log.clientHeight === 0) return;
      this.#following = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
      if (this.#following) this.jump.hidden = true;
    });
  }
  bottom() {
    this.log.scrollTop = this.log.scrollHeight;
    this.#following = true;
    this.jump.hidden = true;
  }
  draw(v: SessionView) {
    const c = sessionCopy(v.lang);
    this.log.setAttribute("aria-label", c.conversation);
    this.jump.textContent = c.jump;
    const key = v.selected?.key ?? "";
    const switched = this.#key !== key;
    if (switched) {
      if (this.#key) this.#positions.set(this.#key, this.log.scrollTop);
      this.#key = key;
      this.#restore = this.#positions.get(key);
      this.#cells.clear();
      this.#following = true;
      this.jump.hidden = true;
    }
    const y = this.log.getBoundingClientRect().top;
    const anchor =
      this.log.clientHeight > 0
        ? Array.from(this.#items.children).find((el) => el.getBoundingClientRect().bottom > y)
        : undefined;
    const before = anchor?.getBoundingClientRect().top ?? 0;
    const priorFirst = this.#items.firstElementChild?.getAttribute("data-turn");
    const priorLast = this.#items.lastElementChild;
    const groups: SessionTurn[][] = [];
    for (const t of v.turns) {
      const last = groups.at(-1);
      if (t.role === "tool" && last?.[0]?.role === "tool") last.push(t);
      else groups.push([t]);
    }
    const retained = new Set<string>();
    for (const [i, group] of groups.entries()) {
      const id = group[0]!.id;
      const sig = JSON.stringify([group, v.lang, v.selected?.agentName]);
      const old = this.#cells.get(id);
      let el = old?.el;
      if (!el || sig !== old?.sig) {
        const fresh = block(group, v, c);
        const fold = fresh.querySelector("details");
        if (fold && el?.querySelector("details")?.open) fold.open = true;
        if (el?.parentNode) el.replaceWith(fresh);
        el = fresh;
        this.#cells.set(id, { sig, el });
      }
      const at = this.#items.children[i];
      if (at !== el) this.#items.insertBefore(el, at ?? null);
      retained.add(id);
    }
    for (const [id, item] of this.#cells)
      if (!retained.has(id)) {
        item.el.remove();
        this.#cells.delete(id);
      }
    while (this.#items.children.length > groups.length) this.#items.lastElementChild?.remove();
    this.#before.replaceChildren();
    if (v.older === "more" || v.older === "loading") {
      const b = action(v.older === "more" ? c.more : c.read, () => v.onOlder?.());
      b.dataset.older = "";
      b.disabled = v.older === "loading";
      this.#before.append(b);
    } else if (v.older === "end") this.#before.append(node("p", "muted", c.end));
    this.#note.replaceChildren();
    if (v.notice || !groups.length)
      this.#note.append(node("p", "muted", v.notice || v.empty || c.first));
    if (v.onRetry) this.#note.append(action(c.retry, v.onRetry));
    if (this.#restore !== undefined && groups.length) {
      this.log.scrollTop = this.#restore;
      this.#restore = undefined;
      this.#following = this.log.scrollHeight - this.log.clientHeight - this.log.scrollTop < 24;
    } else if (
      !switched &&
      anchor?.isConnected &&
      priorFirst !== this.#items.firstElementChild?.getAttribute("data-turn")
    )
      this.log.scrollTop += anchor.getBoundingClientRect().top - before;
    else if (this.#following) this.bottom();
    else if (priorLast !== this.#items.lastElementChild) this.jump.hidden = false;
  }
}
