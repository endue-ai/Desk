import { sessionCopy } from "./agent-session-copy";
import { sessionCss } from "./agent-session-css";
import { SessionDetails } from "./agent-session-details";
import { action, node, slot, status } from "./agent-session-dom";
import type { SessionRow, SessionSource, SessionView } from "./agent-session-model";
import { SessionNav } from "./agent-session-nav";
import { Transcript } from "./agent-session-transcript";
import { Base, shadow } from "./base";

/** One reader for local agent sessions. The adapter owns all reads, writes and prompt controls. */
export class DeskAgentSession extends Base {
  static readonly styles = sessionCss;
  #mount?: Workspace;
  #observer?: ResizeObserver;
  set view(value: SessionView) {
    this.#mount ??= new Workspace(this);
    this.#mount.draw(value);
    this.#observe();
  }
  connectedCallback() {
    this.#observe();
  }
  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = undefined;
  }
  #observe() {
    if (
      !this.isConnected ||
      !this.#mount ||
      this.#observer ||
      typeof ResizeObserver === "undefined"
    )
      return;
    this.#observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) this.#mount?.resize(width);
    });
    this.#observer.observe(this);
  }
}
class Workspace {
  #view: SessionView = { rows: [], turns: [] };
  #width = "wide";
  #detail = true;
  #pane = "nav";
  #last?: string;
  #shell = node("div", "shell");
  #main = node("section", "reader");
  #title = node("h2");
  #sub = node("div", "subhead");
  #path = node("span", "breadcrumb");
  #toggle = action("", () => this.#details(!this.#detail), "quiet detail-toggle");
  #navButton = action(
    "",
    () => {
      this.#pane = "nav";
      this.#layout();
      this.#nav.focus(this.#last);
    },
    "nav-toggle",
  );
  #link = action(
    "",
    () => {
      this.#side.overview();
      this.#details(true);
    },
    "request-link",
  );
  #log = new Transcript();
  #nav = new SessionNav(
    (r, s) => this.#select(r, s),
    () => {
      this.#view.onNew?.();
      this.#pane = "reader";
      this.#detail = this.#width === "wide";
      this.#layout();
      this.#title.focus();
    },
  );
  #side = new SessionDetails(
    () => this.#details(false),
    (r) => this.#select(r),
  );
  constructor(host: HTMLElement) {
    const head = node("header", "reader-head"),
      bar = node("div", "headbar"),
      composer = node("div", "composer");
    this.#title.tabIndex = -1;
    bar.append(this.#navButton, this.#path, this.#toggle);
    head.append(bar, this.#title, this.#sub, slot("actions"));
    composer.append(slot("composer"));
    this.#main.append(head, this.#log.log, this.#log.jump, this.#link, composer);
    this.#shell.append(this.#nav.el, this.#main, this.#side.el);
    const tree = shadow(host, sessionCss, [this.#shell]);
    tree.addEventListener("desk-link", (event) => {
      host.dispatchEvent(
        new CustomEvent("desk-link", { bubbles: true, detail: (event as CustomEvent).detail }),
      );
    });
    this.#shell.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.#side.previewing) {
        e.preventDefault();
        e.stopPropagation();
        this.#side.back();
      } else if (this.#detail && this.#side.el.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        this.#details(false);
      } else if (this.#width === "narrow" && this.#pane === "reader") {
        e.preventDefault();
        e.stopPropagation();
        this.#navButton.click();
      }
    });
  }
  resize(width: number) {
    const size = width >= 720 ? "wide" : width >= 560 ? "medium" : "narrow";
    if (size === this.#width) return;
    this.#width = size;
    this.#detail = size === "wide";
    this.#pane = this.#view.selected ? "reader" : "nav";
    this.#layout();
  }
  #select(row: SessionRow, source?: SessionSource) {
    this.#pane = "reader";
    if (this.#width !== "wide") this.#detail = false;
    this.#last = row.key;
    this.#side.reset();
    this.#layout();
    this.#view.onSelect?.(row, source);
    this.#title.focus({ preventScroll: true });
  }
  #details(open: boolean) {
    this.#detail = open;
    this.#pane = open ? "details" : "reader";
    this.#layout();
    if (open) this.#side.focus();
    else this.#toggle.focus({ preventScroll: true });
  }
  #layout() {
    this.#shell.dataset.detail = this.#detail ? "on" : "off";
    this.#shell.dataset.pane = this.#pane;
    this.#toggle.setAttribute("aria-expanded", String(this.#detail));
    this.#link.hidden = this.#detail || !this.#view.request?.respond;
  }
  draw(v: SessionView) {
    const c = sessionCopy(v.lang);
    const row = v.selected;
    if (row && row.key !== this.#view.selected?.key) {
      this.#last = row.key;
      this.#pane = "reader";
    }
    this.#view = v;
    this.#title.textContent = row?.title ?? c.choose;
    this.#path.textContent = [row?.workspace?.split(/[\\/]/).filter(Boolean).at(-1), c.conversation]
      .filter(Boolean)
      .join(" / ");
    this.#navButton.textContent = c.nav;
    this.#toggle.textContent = c.details;
    this.#link.textContent = c.live;
    this.#sub.replaceChildren();
    if (row) this.#sub.append(node("span", "muted", row.agentName), status(row, c));
    this.#nav.draw(v);
    this.#log.draw(v);
    this.#side.draw(v);
    this.#layout();
  }
}
