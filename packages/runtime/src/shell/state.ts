/** The shell's state in one store, plus the sample desk the prototype starts with. */
import type { Agent, Space } from "@endue-ai/bridge";
import type { BrainStatus } from "../bridge/types";
import type { DensityName } from "../eris/mesh";
import type { SoulStyle } from "../eris/soul";
import type { ErisState } from "../eris/states";
import type { Session } from "../modes/model";
import type { DesktopIndex, Mode, SurfacePlacement } from "../modes/types";
import type { Lang } from "./copy";

/** Work an agent is doing. Local sample data: the gateway has no source for it yet. */
export interface Task {
  id: string;
  /** The agent's id (as the gateway lists it). */
  agent: string;
  title: string;
  /** Clock time the task started (negative: before the shell did). */
  startedAt: number;
  progress: number;
  running: boolean;
}

export interface DrawerItem {
  id: string;
  kind: "surface" | "file" | "recent";
  name: string;
  /** Clock time it entered the drawer; recent items fade after 12 h and leave after 24 h. */
  at: number;
  placement?: SurfacePlacement;
}

export type RailId = "brain" | "sees" | "tasks" | "attention" | "desks" | "vm" | "listen";
export type Popover = RailId | "drawer" | "mode-menu" | "agents-more" | null;

export interface DeskState {
  theme: "dark" | "light";
  lang: Lang;
  reducedMotion: boolean;
  modes: Mode[];
  modeId: string;
  desktop: DesktopIndex;
  session: Session;
  modesOpen: boolean;
  /** Agents and spaces from endue AI's API gateway (specs/brain/v0), loaded through the bridge. */
  spaces: Space[];
  spaceId: string;
  /** Every agent the person owns; `spaceAgents` lists the current space's, in the gateway's order. */
  agents: Agent[];
  spaceAgents: string[];
  agentId: string | null;
  /** Running tasks show in the bottom right and light their agent's dot. */
  tasks: Task[];
  directory: "loading" | "ready" | "offline";
  drawer: DrawerItem[];
  attention: { id: string; text: string }[];
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
const agent = (n: number) => `ag_01JBZ8Q4MR00000000000000${String(n).padStart(2, "0")}`;

function sampleTasks(): Task[] {
  return [
    {
      id: "t-inbox",
      agent: agent(1),
      title: "Sort the inbox",
      startedAt: -(4 * 60_000 + 12_000),
      progress: 0.62,
      running: true,
    },
    {
      id: "t-flights",
      agent: agent(4),
      title: "Compare flights",
      startedAt: -65_000,
      progress: 0.25,
      running: true,
    },
    {
      id: "t-notes",
      agent: agent(2),
      title: "Tidy meeting notes",
      startedAt: 0,
      progress: 0,
      running: false,
    },
  ];
}

export function sampleState(modes: Mode[], lang: Lang): DeskState {
  return {
    theme: "dark",
    lang,
    reducedMotion: false,
    modes,
    modeId: "morning",
    desktop: 1,
    session: {},
    modesOpen: false,
    spaces: [],
    spaceId: "",
    agents: [],
    spaceAgents: [],
    agentId: null,
    tasks: sampleTasks(),
    directory: "loading",
    drawer: [
      { id: "file-brief", kind: "file", name: "brief.pdf", at: -3 * HOUR },
      { id: "recent-weather", kind: "recent", name: "Weather this week", at: -2 * HOUR },
      { id: "recent-summary", kind: "recent", name: "Inbox summary", at: -18 * HOUR },
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
    popover: null,
    dialog: null,
    eris: { state: "idle", density: "balanced", soul: "wisp", saying: "" },
    composer: { open: false, text: "", selected: 0 },
    focused: null,
    pane: null,
  };
}

export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
