/** The shell's state in one store, plus the sample people, spaces and work the prototype starts with. */
import type { BrainStatus } from "../bridge/types";
import type { DensityName } from "../eris/mesh";
import type { SoulStyle } from "../eris/soul";
import type { ErisState } from "../eris/states";
import type { Session } from "../modes/model";
import type { DesktopIndex, Mode, SurfacePlacement } from "../modes/types";
import type { Lang } from "./copy";

export interface Agent {
  id: string;
  name: string;
  /** Working right now: the status-active dot. */
  working: boolean;
  /** Waiting at the edge of the desk: dashed and dimmed. */
  waiting: boolean;
}

export interface Space {
  id: string;
  name: string;
  agents: Agent[];
}

export interface Task {
  id: string;
  agent: string;
  title: string;
  /** Clock time the task started (negative: before the shell did). */
  startedAt: number;
  progress: number;
  running: boolean;
  surface?: string;
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
export type Popover = RailId | "drawer" | "mode-menu" | null;

export interface DeskState {
  theme: "dark" | "light";
  lang: Lang;
  reducedMotion: boolean;
  modes: Mode[];
  modeId: string;
  desktop: DesktopIndex;
  session: Session;
  modesOpen: boolean;
  spaces: Space[];
  spaceId: string;
  agentId: string | null;
  drawer: DrawerItem[];
  tasks: Task[];
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
const MIN = 60_000;

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
    spaces: [
      {
        id: "home",
        name: "Home",
        agents: [
          { id: "mira", name: "Mira", working: true, waiting: false },
          { id: "theo", name: "Theo", working: false, waiting: false },
          { id: "juno", name: "Juno", working: false, waiting: true },
        ],
      },
      {
        id: "studio",
        name: "Studio",
        agents: [
          { id: "kai", name: "Kai", working: true, waiting: false },
          { id: "lena", name: "Lena", working: false, waiting: false },
        ],
      },
    ],
    spaceId: "home",
    agentId: "mira",
    drawer: [
      { id: "file-brief", kind: "file", name: "brief.pdf", at: -3 * HOUR },
      { id: "recent-weather", kind: "recent", name: "Weather this week", at: -2 * HOUR },
      { id: "recent-summary", kind: "recent", name: "Inbox summary", at: -18 * HOUR },
    ],
    tasks: [
      {
        id: "t-inbox",
        agent: "mira",
        title: "Sort the inbox",
        startedAt: -(4 * MIN + 12_000),
        progress: 0.62,
        running: true,
        surface: "tomorrow",
      },
      {
        id: "t-flights",
        agent: "kai",
        title: "Compare flights",
        startedAt: -(1 * MIN + 5_000),
        progress: 0.25,
        running: true,
      },
      {
        id: "t-notes",
        agent: "theo",
        title: "Tidy meeting notes",
        startedAt: 0,
        progress: 0,
        running: false,
      },
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
  };
}

export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
