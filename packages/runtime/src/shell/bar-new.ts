/**
 * The agent bar's last places, as endue.ai's own left bar has them: past six agents, the rest as
 * their faces in one place; New agent at the end of the agents and New space at the end of the
 * spaces. Folded, each is a face with its name under it, so the bar says what they do without a
 * hover; unfolded (bar-unfold.ts), each is a row of the list (bar-list.ts), the rest's the list's own.
 * New agent opens the Agents plugin on its New agent page (`endue.agents.new`), or endue.ai's when
 * the desk has no Agents; New space opens endue.ai's own page for it in a desk window (ADR 0223),
 * as the desk makes no space of its own.
 */
import { WEB } from "../system/endue";
import { showOnDesk } from "../system/endue-web";
import { type BarEntry, barControl } from "./bar-list";
import { withTip } from "./bar-tip";
import type { ShellCtx } from "./context";
import { type Lang, shellText } from "./copy";
import { h } from "./dom";
import { icon } from "./icons";

/** One of the bar's words in `lang`, `n` in place of `{n}` (the shell's catalog, `shell.bar.*`). The
 *  place of the rest's name holds what it shows (WCAG 2.5.3): its caption is the tail of its group's
 *  name for the rest, the directory's (copy.ts `moreAgents`) or endue's (surface/endue/copy.ts),
 *  which count agents differently in Korean. */
export function barWord(lang: Lang, key: BarWord, n = 0): string {
  return shellText(lang, `bar.${key}`, { n });
}
type BarWord = "more" | "moreEndue" | "newAgent" | "newAgentLabel" | "newSpace" | "newSpaceLabel";

/** The Agents plugin, and its command that opens its New agent page. */
export const AGENTS = "endue.agents";
export const NEW_AGENT = "endue.agents.new";
/** endue.ai's own pages for a new agent and a new space. */
export const NEW_AGENT_PAGE = `${WEB}/agents/new`;
export const NEW_SPACE_PAGE = `${WEB}/spaces/new`;
/** How often, and how far apart, the Agents plugin is asked while it is still starting. */
const TRIES = 20;
const APART_MS = 150;
/** The faces the "more" place shows at most; its name says how many there are. */
export const FACES = 4;

/** A face in the "more" place: the agent's own colour when it has one. */
export interface Face {
  colour?: string;
}

export interface MoreOptions {
  /** The name under it: "+N more". */
  caption: string;
  /** The rest's faces, in their order. */
  faces: readonly Face[];
  /** Whether the bar is unfolded into its list, and the wall clock its rows count from. */
  unfolded: boolean;
  now: number;
}

/**
 * The place past six agents, from the list's entry for it (`rest`: its key, its name, its state,
 * its tooltip and what a press does, the same in both forms). Folded, up to four of the rest's
 * faces in a circle, its name under it; unfolded, the list's own row.
 */
export function barMore(rest: BarEntry, o: MoreOptions): HTMLButtonElement {
  if (o.unfolded) return barControl(rest, true, o.now);
  const faces = o.faces.slice(0, FACES);
  const button = h(
    "button",
    {
      class: "icon-button bar-place avatar-more",
      type: "button",
      ...rest.attrs,
      onClick: rest.onClick,
    },
    h(
      "span",
      { class: "bar-place-face bar-more-faces", "data-count": faces.length, "aria-hidden": "true" },
      faces.map((face) =>
        h("span", {
          class: "bar-more-face",
          ...(face.colour ? { style: { "--face-colour": face.colour } } : {}),
        }),
      ),
    ),
    h("span", { class: "bar-place-name", "aria-hidden": "true" }, o.caption),
  );
  return withTip(button, rest.tip);
}

/**
 * A dashed face with a plus, round for an agent and with a button's corners for a space: folded,
 * its name under it; unfolded, a row of the list with its name beside it, a space's lower.
 */
function newControl(
  kind: "agent" | "space",
  key: string,
  label: string,
  caption: string,
  unfolded: boolean,
  onClick: () => void,
): HTMLButtonElement {
  // The face in either form: the list's row face (bar-list.ts) or the place's.
  const face = (form: string, size: number) =>
    h("span", { class: `${form} bar-new-face`, "aria-hidden": "true" }, icon("plus", size));
  if (unfolded) {
    const space = kind === "space" ? " bar-row-space" : "";
    return h(
      "button",
      {
        class: `menu-item bar-row${space} bar-new bar-new-${kind}`,
        type: "button",
        "data-key": key,
        "aria-label": label,
        onClick,
      },
      face("bar-face", 16),
      h("span", { class: "bar-row-text" }, h("span", { class: "bar-row-name" }, caption)),
    );
  }
  return h(
    "button",
    {
      class: `add-button bar-place bar-new bar-new-${kind}`,
      type: "button",
      "data-key": key,
      "aria-label": label,
      onClick,
    },
    face("bar-place-face", 18),
    h("span", { class: "bar-place-name", "aria-hidden": "true" }, caption),
  );
}

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Open the Agents plugin on its New agent page: its window first, then its command, asked again
 * while the plugin is still registering it. endue.ai's page when the desk has no Agents.
 */
export async function openNewAgent(ctx: ShellCtx): Promise<void> {
  const commands = ctx.runtime?.commands;
  if (commands) {
    try {
      await commands.run("desk.plugins.open", { plugin: AGENTS });
      for (let tried = 1; ; tried++) {
        try {
          await commands.run(NEW_AGENT);
          return;
        } catch (error) {
          if (tried >= TRIES) throw error;
          await later(APART_MS);
        }
      }
    } catch {
      // No Agents here: endue.ai's page.
    }
  }
  await showOnDesk(ctx, NEW_AGENT_PAGE);
}

/** New agent, last in the agents' group, in the bar's form (`unfolded`). */
export function newAgentControl(ctx: ShellCtx, lang: Lang, unfolded = false): HTMLButtonElement {
  return newControl(
    "agent",
    "agents-new",
    barWord(lang, "newAgentLabel"),
    barWord(lang, "newAgent"),
    unfolded,
    () => {
      ctx.store.set({ popover: null });
      void openNewAgent(ctx).catch(() => undefined);
    },
  );
}

/** New space, last in the spaces' group: endue.ai's page, in a desk window. */
export function newSpaceControl(ctx: ShellCtx, lang: Lang, unfolded = false): HTMLButtonElement {
  return newControl(
    "space",
    "spaces-new",
    barWord(lang, "newSpaceLabel"),
    barWord(lang, "newSpace"),
    unfolded,
    () => {
      ctx.store.set({ popover: null });
      void showOnDesk(ctx, NEW_SPACE_PAGE).catch(() => undefined);
    },
  );
}
