import { sessionCopy } from "./agent-session-copy";
import { action, node, restoreFocus, status } from "./agent-session-dom";
import type { SessionRequest, SessionRow, SessionTurn, SessionView } from "./agent-session-model";

export class SessionDetails {
  readonly el = node("aside", "details");
  #body = node("div", "detail-body");
  #head = node("header", "pane-head");
  #tabs = node("div", "detail-tabs");
  #tab = "overview";
  #view?: SessionView;
  #peer?: SessionRow;
  #turns?: SessionTurn[];
  #problem = "";
  #read = 0;
  #acks = new Map<string, { busy?: boolean; choice?: string; error?: string }>();
  #sig = "";
  constructor(
    private readonly close: () => void,
    private readonly promote: (r: SessionRow) => void,
  ) {
    this.el.append(this.#head, this.#tabs, this.#body);
  }
  get previewing() {
    return !!this.#peer;
  }
  reset() {
    this.#peer = undefined;
    this.#read++;
    this.#tab = "overview";
    this.#sig = "";
  }
  back() {
    const focus = this.#peer?.key;
    this.#peer = undefined;
    this.#read++;
    this.#draw();
    restoreFocus(this.#body, focus);
  }
  focus() {
    (
      this.#body.querySelector<HTMLElement>("[data-choice]") ?? this.#head.querySelector("button")
    )?.focus();
  }
  draw(v: SessionView) {
    const c = sessionCopy(v.lang);
    if (this.#view?.selected?.key !== v.selected?.key) this.reset();
    this.#view = v;
    this.el.setAttribute("aria-label", c.details);
    const sig = JSON.stringify([
      v.selected,
      v.rows,
      v.lang,
      this.#tab === "activity"
        ? v.turns.filter((t) => !["user", "assistant"].includes(t.role))
        : [],
      v.request?.id,
      v.request?.text,
      v.request?.choices,
      typeof v.request?.respond,
    ]);
    if (this.#sig !== sig) {
      this.#sig = sig;
      this.#draw();
    }
  }
  overview() {
    this.#tab = "overview";
    this.#peer = undefined;
    this.#read++;
    this.#draw();
  }
  async #preview(row: SessionRow) {
    const v = this.#view;
    if (!v) return;
    const token = ++this.#read;
    this.#peer = row;
    this.#turns = undefined;
    this.#problem = "";
    this.#draw();
    this.#head.querySelector("button")?.focus();
    try {
      const turns = (await v.onPreview?.(row)) ?? [];
      if (token !== this.#read) return;
      this.#turns = turns;
    } catch (err) {
      if (token !== this.#read) return;
      this.#problem = err instanceof Error ? err.message : String(err);
    }
    this.#draw();
  }
  #draw() {
    const v = this.#view;
    if (!v) return;
    const c = sessionCopy(v.lang);
    const focus = ((this.el.getRootNode() as ShadowRoot).activeElement as HTMLElement | null)
      ?.dataset.focus;
    const back = action(this.#peer ? c.back : "×", () => (this.#peer ? this.back() : this.close()));
    back.setAttribute("aria-label", this.#peer ? c.back : c.close);
    back.dataset.focus = "details-back";
    this.#head.replaceChildren(node("h3", "", this.#peer ? c.preview : c.details), back);
    this.#body.replaceChildren();
    this.#tabs.replaceChildren();
    if (this.#peer) {
      const peer = this.#peer;
      this.#body.append(
        node("h3", "peer-title", peer.title),
        node("p", "muted", peer.agentName),
        status(peer, c),
      );
      const excerpt = this.#turns?.filter(
        (t) => t.role === "failure" || t.role === "user" || t.role === "assistant",
      );
      const last = ["user", "assistant", "failure"].map((r) =>
        excerpt?.findLast((t) => t.role === r),
      );
      for (const t of excerpt?.filter((t) => last.includes(t)) ?? [])
        this.#body.append(
          node(
            "strong",
            "author",
            t.role === "user" ? c.you : t.role === "failure" ? c.failed : peer.agentName,
          ),
          node("p", "preview-text", t.text),
        );
      if (!excerpt?.length)
        this.#body.append(
          node("p", "muted", this.#problem || (this.#turns ? c.previewEmpty : c.read)),
        );
      if (this.#problem) this.#body.append(action(c.retry, () => void this.#preview(peer)));
      this.#body.append(action(c.promote, () => this.promote(peer), "outline"));
    } else {
      for (const [key, label] of [
        ["overview", c.overview],
        ["activity", c.activity],
      ] as const) {
        const b = action(
          label,
          () => {
            this.#tab = key;
            this.#draw();
          },
          "tab",
        );
        b.setAttribute("aria-pressed", String(this.#tab === key));
        b.dataset.focus = key;
        this.#tabs.append(b);
      }
      const row = v.selected;
      if (this.#tab === "activity") {
        const events = v.turns.filter((t) => !["user", "assistant"].includes(t.role));
        for (const t of events) {
          const line = node("div", "event");
          line.append(
            node(
              "strong",
              "",
              t.name ||
                (t.role === "tool" ? c.tool : t.role === "failure" ? c.failed : c.notification),
            ),
            node("span", "", t.text),
          );
          if (t.at) line.append(node("time", "muted", t.at));
          this.#body.append(line);
        }
        if (!events.length) this.#body.append(node("p", "muted", c.noActivity));
      } else if (row) {
        const req = v.request;
        if (req?.id && req.text) this.#request(row, req);
        const facts = node("dl", "facts");
        for (const [label, value] of [
          [c.source, row.sources.map((s) => c[s]).join(" · ")],
          [c.workspace, row.workspace],
          [c.branch, row.branch],
          [c.model, row.model],
        ]) {
          if (value) facts.append(node("dt", "", label), node("dd", "", value));
        }
        this.#body.append(node("h4", "", c.summary), facts);
        const peers = v.rows.filter(
          (p) =>
            row.workspace &&
            p.workspace === row.workspace &&
            p.key !== row.key &&
            !(row.nativeId && p.agent === row.agent && p.nativeId === row.nativeId),
        );
        if (peers.length) this.#body.append(node("h4", "", c.related));
        for (const p of peers) {
          const b = action(p.title, () => void this.#preview(p), "peer");
          b.dataset.focus = p.key;
          b.append(node("small", "muted", p.agentName));
          this.#body.append(b);
        }
      } else this.#body.append(node("p", "muted", c.choose));
    }
    restoreFocus(this.el, focus);
  }
  #request(row: SessionRow, r: SessionRequest) {
    const c = sessionCopy(this.#view?.lang);
    const id = JSON.stringify([row.key, r.id]),
      ack = this.#acks.get(id);
    const box = node("section", "request");
    box.append(node("strong", "", r.text));
    if (ack?.choice) box.append(node("p", "", `${c.answered} · ${ack.choice}`));
    else if (typeof r.respond === "function") {
      if (ack?.error) box.append(node("p", "problem", ack.error));
      for (const choice of r.choices) {
        const b = action(
          choice.label,
          async () => {
            if (
              this.#acks.get(id)?.busy ||
              this.#acks.get(id)?.choice ||
              this.#view?.selected?.key !== row.key ||
              this.#view.request?.id !== r.id
            )
              return;
            this.#acks.set(id, { busy: true });
            this.#draw();
            try {
              const answer = this.#view?.request?.respond;
              if (!answer || (await answer(choice.id)) === false) throw Error(c.replyError);
              this.#acks.set(id, { choice: choice.label });
            } catch (err) {
              this.#acks.set(id, { error: err instanceof Error ? err.message : c.replyError });
            }
            if (this.#view?.selected?.key === row.key && this.#view.request?.id === r.id)
              this.#draw();
          },
          "outline",
        );
        b.dataset.choice = choice.id;
        b.disabled = !!ack?.busy;
        box.append(b);
      }
    }
    this.#body.append(box);
  }
}
