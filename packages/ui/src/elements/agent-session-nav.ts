import { recent, sessionCopy } from "./agent-session-copy";
import { action, node, restoreFocus, slot, status } from "./agent-session-dom";
import {
  mergeSessionRows,
  type SessionRow,
  type SessionSource,
  type SessionView,
} from "./agent-session-model";

export class SessionNav {
  readonly el = node("nav", "navigator");
  readonly search = node("input", "search");
  #filters = node("details", "filters");
  #agent = node("select");
  #source = node("select");
  #scope = node("div", "scope");
  #list = node("div", "session-list");
  #tools = node("div", "nav-tools");
  #collapsed = new Set<string>();
  #needs = false;
  #view?: SessionView;
  #sig = "";
  constructor(
    private readonly pick: (row: SessionRow, source?: SessionSource) => void,
    private readonly fresh: () => void,
  ) {
    this.search.type = "search";
    this.search.addEventListener("input", () => {
      this.#view?.onQuery?.(this.search.value.trim());
      this.#drawList();
    });
    this.#filters.append(node("summary"));
    this.#filters.append(this.#agent, this.#source);
    for (const sel of [this.#agent, this.#source])
      sel.addEventListener("change", () => this.#drawList());
    this.el.append(
      node("h3"),
      this.search,
      this.#scope,
      this.#filters,
      slot("navigation"),
      this.#list,
      this.#tools,
    );
    this.#list.addEventListener("keydown", (event) => {
      const rows = Array.from(this.#list.querySelectorAll<HTMLButtonElement>("[data-session-key]"));
      const index = rows.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const next = (
        { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rows.length - 1 } as Record<
          string,
          number
        >
      )[event.key];
      if (next !== undefined) {
        event.preventDefault();
        rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
      }
    });
  }
  draw(v: SessionView) {
    this.#view = v;
    const sig = JSON.stringify([
      v.rows,
      v.selected?.key,
      v.lang,
      v.pages,
      v.listNotice,
      !!v.onRetryList,
      v.now ? Math.floor(v.now / 60000) : 0,
    ]);
    if (sig === this.#sig) return;
    this.#sig = sig;
    const c = sessionCopy(v.lang);
    this.el.setAttribute("aria-label", c.sessions);
    this.el.querySelector("h3")!.textContent = c.sessions;
    this.search.placeholder = c.search;
    this.search.setAttribute("aria-label", c.search);
    const filters = this.#filters.querySelector("summary")!;
    filters.textContent = c.filters;
    const options = (s: HTMLSelectElement, label: string, entries: Map<string, string>) => {
      const prior = s.value;
      s.setAttribute("aria-label", label);
      s.replaceChildren();
      for (const [value, text] of [["", label], ...entries]) {
        const op = node("option", "", text);
        op.value = value ?? "";
        s.append(op);
      }
      s.value = entries.has(prior) ? prior : "";
    };
    options(this.#agent, c.agents, new Map(v.rows.map((r) => [r.agent, r.agentName])));
    options(
      this.#source,
      c.sources,
      new Map(v.rows.flatMap((r) => r.sources.map((s) => [s, c[s]] as const))),
    );
    this.#drawList();
  }
  focus(key?: string) {
    const rows = [...this.#list.querySelectorAll<HTMLButtonElement>("[data-session-key]")];
    (rows.find((b) => b.dataset.sessionKey === key) ?? this.search).focus();
  }
  #drawList() {
    const v = this.#view;
    if (!v) return;
    const c = sessionCopy(v.lang),
      lang = v.lang || "en";
    const focus = ((this.el.getRootNode() as ShadowRoot).activeElement as HTMLElement | null)
      ?.dataset.focus;
    this.#scope.replaceChildren(
      ...[c.all, c.waiting].map((label, i) => {
        const b = action(
          label,
          () => {
            this.#needs = !!i;
            this.#drawList();
          },
          "scope-button",
        );
        b.setAttribute("aria-pressed", String(this.#needs === !!i));
        b.dataset.focus = label;
        return b;
      }),
    );
    const rows = mergeSessionRows(v.rows);
    const query = this.search.value.trim().toLocaleLowerCase();
    const groups = new Map<string, SessionRow[]>();
    for (const row of rows) {
      if (
        (this.#needs && row.status !== "waiting") ||
        (this.#agent.value && this.#agent.value !== row.agent) ||
        (this.#source.value && !row.sources.includes(this.#source.value as SessionSource))
      )
        continue;
      if (
        query &&
        ![row.title, row.workspace, row.branch, row.agentName]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      const group = row.workspace ?? "";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(row);
    }
    const folder = (path: string) =>
      path.split(/[\\/]/).filter(Boolean).at(-1) || path || c.unknown;
    const counts = new Map<string, number>();
    for (const path of groups.keys()) counts.set(folder(path), (counts.get(folder(path)) ?? 0) + 1);
    this.#list.replaceChildren();
    for (const [path, items] of groups) {
      const basename = folder(path);
      const name = path && (counts.get(basename) ?? 0) > 1 ? path : basename;
      const fold = action(
        name,
        () => {
          if (this.#collapsed.has(path)) this.#collapsed.delete(path);
          else this.#collapsed.add(path);
          this.#drawList();
        },
        "workspace",
      );
      fold.title = path || name;
      fold.setAttribute("aria-label", name);
      fold.dataset.focus = `group-${path}`;
      fold.setAttribute("aria-expanded", String(!this.#collapsed.has(path)));
      this.#list.append(fold);
      if (this.#collapsed.has(path)) continue;
      for (const row of items) {
        const b = action(
          "",
          () => this.pick(row, (this.#source.value as SessionSource) || undefined),
          "session",
        );
        b.dataset.sessionKey = row.key;
        b.dataset.agent = row.agent;
        b.dataset.focus = row.key;
        if (row.nativeId) b.dataset.nativeId = row.nativeId;
        b.setAttribute(
          "aria-current",
          String(
            row.key === v.selected?.key ||
              (!!row.nativeId &&
                row.agent === v.selected?.agent &&
                row.nativeId === v.selected.nativeId),
          ),
        );
        const line = node("span", "row-meta");
        line.append(node("span", "", row.agentName));
        if (row.status) line.append(status(row, c));
        const when = recent(row.updatedAt, lang, v.now ?? Date.now());
        if (when) line.append(node("time", "", when));
        b.append(node("strong", "row-title", row.title), line);
        this.#list.append(b);
      }
    }
    if (!groups.size)
      this.#list.append(node("p", "muted", v.listNotice || (rows.length ? c.matches : c.empty)));
    else if (v.listNotice) this.#list.append(node("p", "muted", v.listNotice));
    this.#tools.replaceChildren(
      ...(v.pages ?? []).map((page) => action(page.label, () => this.#view?.onPage?.(page.id))),
    );
    if (v.onNew) this.#tools.append(action(c.newSession, this.fresh));
    if (v.onRetryList) this.#tools.append(action(c.retry, () => this.#view?.onRetryList?.()));
    restoreFocus(this.el, focus);
  }
}
