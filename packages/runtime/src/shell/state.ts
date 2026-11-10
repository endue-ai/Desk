/**
 * The shell's state in one store, the empty desk the app starts with and the sample desk the dev
 * page and the fixtures start with. Profiles and Eris's settings mirror the runtime's (link.ts);
 * the theme is desk.theme's. The windows, panes, desktops, the drawer and the pan are the window
 * manager's (crates/desk-wm, #83): the store holds the last desk it published (`wm/take.ts`) and
 * nothing else writes them.
 */
import type { A2ATask, Agent, AgentCard, LocalAgent, LocalAgentRun, Space } from "@endue-ai/bridge";
import type { BrainStatus } from "../bridge/types";
import type { DensityName } from "../eris/mesh";
import type { SoulStyle } from "../eris/soul";
import type { ErisState } from "../eris/states";
import type { Session } from "../modes/model";
import { baseMode } from "../modes/profiles";
import type { Desktop, DesktopId, DesktopRef, Mode } from "../modes/types";
import { type EndueState, emptyEndue } from "../system/endue-ids";
import type { Adopted, DrawerItem, WmView } from "../wm/types";
import { emptyView } from "../wm/view";
import type { Lang } from "./copy";

export type { DrawerItem };

export type RailId = "brain" | "sees" | "tasks" | "desks" | "vm" | "listen";

/** Something that needs the person, in the inbox; `action` is a button that runs a command. */
export interface AttentionItem {
  id: string;
  text: string;
  action?: { label: string; command: string };
}
export type Popover =
  | RailId
  | "attention"
  | "account"
  | "drawer"
  | "mode-menu"
  | "agents-more"
  /** A desktop's menu in the switcher, a window's menu, the desktops overview (ADR 0117). */
  | "desktop-menu"
  | "window-menu"
  | "desktops-overview"
  | null;

export interface DeskState {
  lang: Lang;
  /** The profiles as the shell lays them out (base first), from desk.profiles. */
  modes: Mode[];
  /** The profile in force. */
  modeId: string;
  /** The last desk the window manager published, its revision, and what the runtime reads of it. */
  rev: number;
  wm: WmView;
  /** The desktop in front, by id (ADR 0117). */
  desktop: DesktopRef;
  /** The desktops' layouts moved since the profile was saved, by id. */
  session: Session;
  /** The desktops as the person changed them since the profile was saved; null: the profile's. */
  desktops: Desktop[] | null;
  /** Canvas offset per desktop, by id; navigation does not dirty the saved window layout. */
  pan: Partial<Record<DesktopId, { x: number; y: number }>>;
  /** The canvas map in the bottom right is folded to its button (shell/Minimap.ts). */
  mapFolded: boolean;
  /** The window (and pane) each desktop had in use when the person left it, by id. */
  focusBy: Partial<Record<DesktopId, { window: string; pane: string | null }>>;
  modesOpen: boolean;
  /** The agent directory (specs/brain/v0), loaded through the bridge. */
  spaces: Space[];
  spaceId: string;
  /** Every agent the person owns, for names; `spaceAgents` orders the current space's. */
  agents: Agent[];
  spaceAgents: string[];
  agentId: string | null;
  cards: Record<string, AgentCard | "missing">;
  /** A2A tasks: working ones run in the bottom right and light the agent's dot. */
  tasks: A2ATask[];
  directory: "loading" | "ready" | "offline";
  /** The person's endue AI agents and spaces once signed in (ADR 0129): they replace the directory. */
  endue: EndueState;
  /** The agent programs on this computer (ADR 0110), from agents.list: the agent bar lists them. */
  localAgents: LocalAgent[];
  /** Their runs, newest first, as agents.runs and agents.run events tell them. */
  localRuns: LocalAgentRun[];
  /** The runs Eris handed out with her desk.agents.* tools, so their screens say so. */
  erisRuns: string[];
  /** What is put away: never a surface that a desktop places (#4). */
  drawer: DrawerItem[];
  /**
   * Plugin surfaces the runtime handed to the shell's windows (ADR 0040), in mount order, each with
   * the slot its window takes while no layout places it and the canvas's pan when it arrived.
   */
  adopted: Adopted[];
  attention: AttentionItem[];
  desks: { id: string; name: string; busy: boolean; here: boolean }[];
  brain: BrainStatus;
  sees: { folders: string[]; calendar: boolean; mail: boolean; mic: boolean };
  vm: "resting" | "on" | "none";
  listening: boolean;
  popover: Popover;
  dialog: "new-mode" | null;
  eris: { state: ErisState; density: DensityName; soul: SoulStyle; saying: string };
  composer: { open: boolean; text: string; selected: number };
  /** Surface id with keyboard/pointer focus; it draws on top. */
  focused: string | null;
  /** The focused pane inside the focused surface. */
  pane: string | null;
}

type Listener = (state: DeskState, previous: DeskState) => void;

/** The shell's state. */
export class Store {
  #state: DeskState;
  #listeners = new Set<Listener>();

  constructor(initial: DeskState) {
    this.#state = initial;
  }

  get(): DeskState {
    return this.#state;
  }

  set(patch: Partial<DeskState> | ((s: DeskState) => Partial<DeskState>)): void {
    const previous = this.#state;
    const change = typeof patch === "function" ? patch(previous) : patch;
    this.#state = { ...previous, ...change };
    for (const listener of [...this.#listeners]) listener(this.#state, previous);
  }

  /** Call `listener` whenever `select` returns something new (compared by JSON). */
  watch<T>(select: (s: DeskState) => T, listener: (value: T) => void): () => void {
    let last = JSON.stringify(select(this.#state));
    const wrapped: Listener = (s) => {
      const value = select(s);
      const json = JSON.stringify(value);
      if (json === last) return;
      last = json;
      listener(value);
    };
    this.#listeners.add(wrapped);
    return () => this.#listeners.delete(wrapped);
  }
}

const HOUR = 3_600_000;

/** What the app starts with: the base profile, nothing in the drawer, no brain until the core says. */
export function emptyState(lang: Lang): DeskState {
  return {
    lang,
    // The base until desk.profiles lists the profiles.
    modes: [baseMode(undefined)],
    modeId: "default",
    rev: 0,
    wm: emptyView(),
    desktop: "1",
    session: {},
    desktops: null,
    pan: {},
    mapFolded: false,
    focusBy: {},
    modesOpen: false,
    spaces: [],
    spaceId: "",
    agents: [],
    spaceAgents: [],
    agentId: null,
    cards: {},
    tasks: [],
    directory: "loading",
    endue: emptyEndue(),
    localAgents: [],
    localRuns: [],
    erisRuns: [],
    drawer: [],
    adopted: [],
    attention: [],
    desks: [],
    brain: { mode: "offline" },
    sees: { folders: [], calendar: false, mail: false, mic: false },
    vm: "resting",
    listening: false,
    popover: null,
    dialog: null,
    eris: { state: "idle", density: "balanced", soul: "wisp", saying: "" },
    composer: { open: false, text: "", selected: 0 },
    focused: null,
    pane: null,
  };
}

/**
 * The sample desk the dev page and the fixtures start with (never the app): drawer items dated
 * from `epoch` in wall-clock milliseconds, things that need attention, other desks, a local brain.
 */
export function sampleState(lang: Lang, epoch = Date.now()): DeskState {
  return {
    ...emptyState(lang),
    drawer: [
      { id: "file-brief", kind: "file", name: "brief.pdf", at: epoch - 3 * HOUR },
      { id: "recent-weather", kind: "recent", name: "Weather this week", at: epoch - 2 * HOUR },
      { id: "recent-summary", kind: "recent", name: "Inbox summary", at: epoch - 18 * HOUR },
    ],
    attention: [
      { id: "a-overlap", text: "Two meetings overlap at 14:00" },
      { id: "a-pay", text: "Approve the invoice from Studio" },
    ],
    desks: [
      { id: "laptop", name: "MacBook Air", busy: false, here: true },
      { id: "studio-pc", name: "Studio PC", busy: true, here: false },
    ],
    brain: { mode: "local", model: "llama-3.2-3b" },
    sees: { folders: ["~/Documents"], calendar: true, mail: false, mic: true },
    vm: "resting",
    listening: true,
  };
}

export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
