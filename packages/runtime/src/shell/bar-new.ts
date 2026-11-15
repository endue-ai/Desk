/**
 * The agent bar's last places, as endue.ai's own left bar has them: past six agents, the rest as
 * their faces in one place; New agent at the end of the agents and New space at the end of the
 * spaces. Each is a face with its name under it, so the bar says what they do without a hover.
 * New agent opens the Agents plugin on its New agent page (`endue.agents.new`), or endue.ai's when
 * the desk has no Agents; New space opens endue.ai's own page for it in a desk window (ADR 0223),
 * as the desk makes no space of its own.
 */
import { WEB } from "../system/endue";
import { showOnDesk } from "../system/endue-web";
import type { ShellCtx } from "./context";
import type { Lang } from "./copy";
import { h } from "./dom";
import { icon } from "./icons";

const words = {
  more: ["+{n} 더보기", "+{n} more"],
  newAgent: ["새 에이전트", "New agent"],
  newAgentLabel: ["새 에이전트 만들기", "Create a new agent"],
  newSpace: ["새 스페이스", "New space"],
  newSpaceLabel: ["새 스페이스 만들기", "Create a new space"],
} as const;

/** One of the bar's words in `lang`, `n` in place of `{n}`. */
export function barWord(lang: Lang, key: keyof typeof words, n = 0): string {
  const [ko, en] = words[key];
  return (lang === "ko" ? ko : en).replace("{n}", String(n));
}

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
  key: string;
  /** Its accessible name: how many agents it holds. */
  label: string;
  /** The name under it. */
  caption: string;
  faces: readonly Face[];
  expanded: boolean;
  onClick: () => void;
}

/** The place past six agents: up to four of the rest's faces in a circle, its name under it. */
export function moreControl(o: MoreOptions): HTMLButtonElement {
  const faces = o.faces.slice(0, FACES);
  return h(
    "button",
    {
      class: "icon-button bar-labeled avatar-more",
      type: "button",
      "data-key": o.key,
      "aria-label": o.label,
      "aria-expanded": String(o.expanded),
      onClick: o.onClick,
    },
    h(
      "span",
      { class: "bar-face bar-more-faces", "data-count": faces.length, "aria-hidden": "true" },
      faces.map((face) =>
        h("span", {
          class: "bar-more-face",
          ...(face.colour ? { style: { "--face-colour": face.colour } } : {}),
        }),
      ),
    ),
    h("span", { class: "bar-caption", "aria-hidden": "true" }, o.caption),
  );
}

/** A dashed face with a plus, round for an agent and with a button's corners for a space. */
function newControl(
  kind: "agent" | "space",
  key: string,
  label: string,
  caption: string,
  onClick: () => void,
): HTMLButtonElement {
  return h(
    "button",
    {
      class: `add-button bar-labeled bar-new bar-new-${kind}`,
      type: "button",
      "data-key": key,
      "aria-label": label,
      onClick,
    },
    h("span", { class: "bar-face", "aria-hidden": "true" }, icon("plus", 18)),
    h("span", { class: "bar-caption", "aria-hidden": "true" }, caption),
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

/** New agent, last in the agents' group. */
export function newAgentControl(ctx: ShellCtx, lang: Lang): HTMLButtonElement {
  return newControl(
    "agent",
    "agents-new",
    barWord(lang, "newAgentLabel"),
    barWord(lang, "newAgent"),
    () => {
      ctx.store.set({ popover: null });
      void openNewAgent(ctx).catch(() => undefined);
    },
  );
}

/** New space, last in the spaces' group: endue.ai's page, in a desk window. */
export function newSpaceControl(ctx: ShellCtx, lang: Lang): HTMLButtonElement {
  return newControl(
    "space",
    "spaces-new",
    barWord(lang, "newSpaceLabel"),
    barWord(lang, "newSpace"),
    () => {
      ctx.store.set({ popover: null });
      void showOnDesk(ctx, NEW_SPACE_PAGE).catch(() => undefined);
    },
  );
}
