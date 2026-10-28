import type {
  A2ATaskList,
  A2ATaskStatus,
  AgentCard,
  AgentList,
  AgentStatus,
  SpaceList,
} from "@endue-ai/bridge";

/**
 * What the desk shell needs from the host. The browser stub (`browser.ts`) implements it for development
 * and tests; a Tauri adapter over `@endue-ai/bridge` comes later.
 */

/** Nine band energies in 0..1, index 0 = 80 Hz … 8 = 8 kHz (see `eris/voice.ts`). */
export type Bands = readonly number[];

export interface AudioLevels {
  /** The user's microphone. */
  user: Bands;
  /** Eris's own voice (TTS output). */
  eris: Bands;
}

export type BrainStatus =
  | { mode: "local"; model: string }
  | { mode: "cloud"; credits: number }
  | { mode: "offline" };

export interface WordTime {
  word: string;
  /** Milliseconds after the reply starts. */
  at: number;
}

export interface BrainReply {
  text: string;
  /** TTS word timestamps when the voice has them. */
  words?: WordTime[];
}

/** Query of listAgents (specs/brain/v0): one space, one status, one page. */
export interface AgentQuery {
  spaceId?: string;
  status?: AgentStatus;
  page?: number;
  limit?: number;
}

/** Query of listA2ATasks (specs/brain/v0). */
export interface TaskQuery {
  targetAgentId?: string;
  status?: A2ATaskStatus;
  page?: number;
  limit?: number;
}

export interface ShellBridge {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  perm: {
    /** Ask the user for a scope ("fs.read:~/Documents", "calendar", "mail", "mic"). */
    request(scope: string): Promise<boolean>;
  };
  audio: {
    /** Band energies right now, before smoothing. Silent bands are 0. */
    levels(): AudioLevels;
  };
  brain: {
    status(): Promise<BrainStatus>;
    use(mode: "local" | "cloud"): Promise<BrainStatus>;
    say(text: string): Promise<BrainReply>;
  };
  /** The agent directory of specs/brain/v0, which endue AI serves from its agent and A2A APIs. */
  agents: {
    list(query?: AgentQuery): Promise<AgentList>;
    card(agentId: string): Promise<AgentCard>;
  };
  spaces: {
    list(): Promise<SpaceList>;
  };
  a2a: {
    tasks(query?: TaskQuery): Promise<A2ATaskList>;
  };
}
