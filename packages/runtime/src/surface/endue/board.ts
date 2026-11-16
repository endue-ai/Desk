/**
 * An endue agent's Studio board (ADR 0232), the back of its card: the ways requests come in at the
 * left, the agent's own sheet in the middle, what it reaches at the right, and lines between them.
 * It follows endue.ai's Studio. A row with more to say unfolds where it stands; every row, every
 * line of the sheet and every action opens its part of endue.ai's Studio in a desk window (ADR
 * 0223), where the person changes it: the board itself only reads.
 */
import type { ShellCtx } from "../../shell/context";
import { type Child, h } from "../../shell/dom";
import { icon } from "../../shell/icons";
import { agentHome, facePicture, WEB } from "../../system/endue";
import { showOnDesk } from "../../system/endue-web";
import { type BoardKey, boardText } from "./board-copy";
import { type LineSpec, linesLayer } from "./board-lines";
import type { Badge, Board, BoardRow, RowAction, SheetRow } from "./board-model";
import { dotOf } from "./model";

/** A part of an agent's Studio on endue.ai: `https://endue.ai/agent/<id>/studio/<section>`. */
export const studioSection = (id: string, section: string) =>
  `${WEB}/agent/${encodeURIComponent(id)}/studio/${encodeURIComponent(section)}`;

export interface BoardView {
  agentId: string;
  /** The agent's face as a data: URL, when the core read one. */
  picture?: string;
  /** The row unfolded, if any. */
  expanded: string | null;
  toggle(row: string): void;
}

/** The lines the board's rows ask for; an unfolded row's is drawn heavier. */
export function lineSpecs(board: Board, expanded: string | null): LineSpec[] {
  return [...board.inbound, ...board.outbound].map((row) => ({
    id: row.id,
    side: row.side,
    state: row.state,
    selected: row.id === expanded,
  }));
}

export function studioBoardView(ctx: ShellCtx, board: Board, view: BoardView): HTMLElement {
  const lang = ctx.store.get().lang;
  const t = (key: BoardKey, vars?: Record<string, string | number>) => boardText(lang, key, vars);
  const show = (url: string) => void showOnDesk(ctx, url).catch(() => undefined);
  const open = (section: string) => show(studioSection(view.agentId, section));
  const opens = (name: string) => t("opens", { name });

  const action = (row: string, a: RowAction) =>
    h(
      "button",
      {
        class: `btn btn-xs${a.primary ? " btn-outline" : ""}`,
        type: "button",
        "data-key": `studio-${row}-${a.key}`,
        "data-row-action": a.key,
        ...(a.tone ? { "data-tone": a.tone } : {}),
        title: opens(a.label),
        onClick: () => (a.section ? open(a.section) : show(agentHome(view.agentId))),
      },
      a.label,
      a.key === "details" ? " ›" : null,
    );

  const rowOf = (row: BoardRow): HTMLElement => {
    const unfolds = Boolean(row.body);
    const isOpen = unfolds && view.expanded === row.id;
    const body = `studio-body-${row.id}`;
    return h(
      "div",
      {
        class: "studio-row",
        "data-row": row.id,
        "data-state": row.state,
        ...(isOpen ? { "data-expanded": "" } : {}),
      },
      h(
        "button",
        {
          class: "menu-item studio-row-head",
          type: "button",
          "data-key": `studio-row-${row.id}`,
          "data-row-head": "",
          ...(unfolds
            ? { "aria-expanded": String(isOpen), ...(isOpen ? { "aria-controls": body } : {}) }
            : { title: opens(row.title) }),
          onClick: () => (unfolds ? view.toggle(row.id) : open(row.section)),
        },
        h(
          "span",
          { class: `studio-row-icon${row.mono ? " is-mono" : ""}`, "aria-hidden": "true" },
          row.icon ? icon(row.icon, 16) : row.mono,
        ),
        h(
          "span",
          { class: "studio-row-text" },
          h("span", { class: "studio-row-title" }, row.title),
          row.sub
            ? h(
                "span",
                { class: "studio-row-sub", ...(row.subTone ? { "data-tone": row.subTone } : {}) },
                row.sub,
              )
            : null,
        ),
        row.meta ? h("span", { class: "studio-row-meta" }, row.meta) : null,
      ),
      isOpen && row.body
        ? h(
            "div",
            { class: "studio-row-body", id: body },
            row.body.text.map((line) => h("p", {}, line)),
            row.body.items?.length
              ? h(
                  "div",
                  { class: "studio-actions", "data-items": "" },
                  row.body.items.map((a) => action(row.id, a)),
                )
              : null,
            h(
              "div",
              { class: "studio-actions" },
              row.body.actions.map((a) => action(row.id, a)),
            ),
          )
        : null,
    );
  };

  const column = (side: "in" | "out", index: string, heading: string, children: Child[]) =>
    h(
      "div",
      { class: "studio-col", "data-col": side, role: "group", "aria-label": heading },
      h(
        "div",
        { class: "studio-col-head" },
        h("span", { class: "studio-col-index" }, index),
        heading,
      ),
      ...children,
    );

  const badges = (list: Badge[]) =>
    h(
      "span",
      { class: "studio-badges" },
      list.map((b) =>
        h(
          "span",
          {
            class: "studio-badge",
            "data-badge": b.key,
            ...(b.on ? { "data-on": "" } : {}),
            title: t(b.on ? "badgeOn" : "badgeOff", { name: b.label }),
            role: "img",
            "aria-label": t(b.on ? "badgeOn" : "badgeOff", { name: b.label }),
          },
          icon(b.icon, 16),
        ),
      ),
    );

  const sheetRow = (row: SheetRow) =>
    h(
      "button",
      {
        class: `menu-item studio-sheet-row${row.stack ? " is-stack" : ""}`,
        type: "button",
        "data-key": `studio-sheet-${row.section}`,
        "data-section": row.section,
        title: opens(row.label),
        onClick: () => open(row.section),
      },
      h("span", { class: "studio-sheet-key" }, row.label),
      h(
        "span",
        { class: `studio-sheet-value${row.muted ? " is-muted" : ""}` },
        row.badges ? badges(row.badges) : row.value,
      ),
      h("span", { class: "studio-sheet-end", "aria-hidden": "true" }, "›"),
    );

  const hub = board.hub;
  const picture = facePicture(view.picture);
  const card = h(
    "section",
    { class: "studio-hub", "data-hub": "", "aria-label": hub.name },
    h(
      "div",
      { class: "studio-hub-head" },
      h(
        "div",
        { class: "studio-portrait", "data-hub-port": "" },
        picture
          ? h("img", { class: "studio-portrait-face", src: picture, alt: "", draggable: "false" })
          : h("span", { class: "studio-portrait-initial", "aria-hidden": "true" }, hub.initial),
        h(
          "button",
          {
            class: "btn btn-xs btn-outline studio-portrait-action",
            type: "button",
            "data-key": "studio-character",
            "data-section": "character",
            title: opens(t("character")),
            onClick: () => open("character"),
          },
          t("character"),
        ),
      ),
      h(
        "div",
        { class: "studio-who" },
        h(
          "div",
          { class: "studio-name-row" },
          h(
            "button",
            {
              class: "menu-item studio-name",
              type: "button",
              "data-key": "studio-profile",
              "data-section": "profile",
              title: opens(t("profile")),
              onClick: () => open("profile"),
            },
            hub.name,
          ),
          h(
            "span",
            { class: "studio-status", "data-presence": hub.presence },
            h("span", { class: `dot ${dotOf(hub.presence)}`, "aria-hidden": "true" }),
            hub.presenceLabel,
          ),
        ),
        h("span", { class: "studio-handle" }, hub.handle),
        hub.description ? h("p", { class: "studio-desc" }, hub.description) : null,
      ),
    ),
    h(
      "p",
      { class: "studio-sentence", "aria-label": t("sentenceLabel") },
      hub.sentence.map((seg) =>
        seg.tone ? h("span", { class: `is-${seg.tone}` }, seg.text) : seg.text,
      ),
    ),
    h(
      "div",
      { class: "studio-sheet" },
      h(
        "div",
        { class: "studio-group", role: "group", "aria-label": t("identity") },
        h("span", { class: "studio-group-head", "aria-hidden": "true" }, t("identity")),
        hub.identity.map(sheetRow),
      ),
      h(
        "div",
        { class: "studio-group", role: "group", "aria-label": t("abilities") },
        h("span", { class: "studio-group-head", "aria-hidden": "true" }, t("abilities")),
        h(
          "div",
          { class: "studio-skills", "data-sheet": "skills" },
          h("span", { class: "studio-sheet-key" }, hub.skills.label),
          h(
            "button",
            {
              class: "btn btn-xs",
              type: "button",
              "data-key": "studio-sheet-skills",
              "data-section": "skills",
              title: opens(hub.skills.label),
              onClick: () => open("skills"),
            },
            t("addSkill"),
          ),
          h(
            "span",
            { class: "studio-chips" },
            !hub.skills.read
              ? h("span", { class: "studio-sheet-value is-muted" }, hub.skills.value)
              : hub.skills.chips.length
                ? hub.skills.chips.map((chip) => h("span", { class: "tag", title: chip }, chip))
                : h("span", { class: "studio-sheet-value is-muted" }, t("noSkills")),
            hub.skills.more ? h("span", { class: "tag" }, `+${hub.skills.more}`) : null,
          ),
        ),
        sheetRow(hub.tools),
      ),
    ),
    h(
      "div",
      { class: "studio-hub-foot" },
      (["analytics", "relations", "settings"] as const).map((section) =>
        h(
          "button",
          {
            class: "btn btn-xs btn-outline",
            type: "button",
            "data-key": `studio-foot-${section}`,
            "data-section": section,
            title: opens(t(section)),
            onClick: () => open(section),
          },
          t(section),
        ),
      ),
    ),
  );

  const outbound: Child[] = [
    // Not read: the group says so, with no count (issue 352).
    board.connectors.count || !board.connectors.read
      ? h(
          "div",
          { class: "studio-group-line" },
          h(
            "span",
            {},
            t("connectorsGroup", {
              n: board.connectors.read ? board.connectors.count : board.connectors.value,
            }),
          ),
          h(
            "button",
            {
              class: "btn btn-xs",
              type: "button",
              "data-key": "studio-connectors-manage",
              "data-section": "connectors",
              title: opens(t("manage")),
              onClick: () => open("connectors"),
            },
            t("manage"),
            " ›",
          ),
        )
      : null,
    board.outbound.filter((row) => row.id.startsWith("connector-")).map(rowOf),
    board.connectors.more
      ? h(
          "button",
          {
            class: "btn btn-xs studio-wide",
            type: "button",
            "data-key": "studio-connectors-more",
            "data-section": "connectors",
            onClick: () => open("connectors"),
          },
          t("connectorsMore", { n: board.connectors.more }),
        )
      : null,
    board.outbound.filter((row) => !row.id.startsWith("connector-")).map(rowOf),
    h(
      "button",
      {
        class: "btn btn-xs btn-outline studio-wide",
        type: "button",
        "data-key": "studio-connectors-add",
        "data-section": "connectors",
        title: opens(t("addConnector")),
        onClick: () => open("connectors"),
      },
      t("addConnector"),
      " ",
      h("span", { class: "studio-hint" }, t("addConnectorHint")),
    ),
    h(
      "div",
      { class: "studio-roadmap" },
      h("span", { class: "tag" }, t("roadmap")),
      t("subAgents"),
    ),
  ];

  return h(
    "div",
    { class: "studio-board", "data-studio-board": view.agentId },
    h(
      "div",
      { class: "studio-grid" },
      column("in", "01", t("headIn"), board.inbound.map(rowOf)),
      h("div", { class: "studio-gap", "aria-hidden": "true" }),
      h(
        "div",
        { class: "studio-hub-col" },
        h(
          "div",
          { class: "studio-col-head is-hub" },
          h("span", { class: "studio-col-index" }, "02"),
          t("headHub"),
        ),
        card,
      ),
      h("div", { class: "studio-gap", "aria-hidden": "true" }),
      column("out", "03", t("headOut"), outbound),
    ),
    linesLayer(),
  );
}
