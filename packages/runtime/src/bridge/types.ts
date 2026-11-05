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

/** A brain the desk can choose for Eris (ADR 0094). */
export type BrainName = "endue" | "local" | "echo";

/**
 * Which brain answers. `brain` is the one the desk chose, where it can choose; `fallback` marks the
 * local brain answering in place of a chosen one that cannot be reached.
 */
export type BrainStatus =
  | { mode: "local"; model: string; brain?: BrainName; fallback?: boolean }
  | { mode: "cloud"; credits: number; brain?: BrainName }
  | { mode: "offline"; brain?: BrainName };

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

/**
 * One hand-off of Eris's agentic loop (ADR 0089), as brain.turn's tool and tool-result say it: she
 * goes to the command's plugin (`tool`) and comes back with its answer (`tool-result`).
 */
export interface BrainStep {
  kind: "tool" | "tool-result";
  callId: string;
  /** The command the brain's call runs, `endue.mail.latest`. */
  command: string;
  /** Who provides it: a plugin id, or `desk`. */
  provider: string;
  title?: string;
  /** tool-result only: whether the command answered without an error. */
  ok?: boolean;
}

/** The desk's endue ID, as account.* answers it; the token never reaches the runtime. */
export interface AccountStatus {
  state: "signed-out" | "signing-in" | "signed-in";
  /** While signing in: the code the person enters, and where. */
  signIn?: { userCode: string; verificationUri: string; verificationUriComplete?: string };
  /** Why the last sign-in did not go through, for people. */
  problem?: string;
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
  /** The local name collected during first run; hosts without user information may omit this. */
  user?: { info(): Promise<{ name?: string }> };
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
    /** Choose Eris's brain; answers the status once the desk switched. */
    use(brain: BrainName): Promise<BrainStatus>;
    /** One turn of Eris's loop: its hand-offs reach `onStep` as they happen, then the reply. */
    say(text: string, onStep?: (step: BrainStep) => void): Promise<BrainReply>;
  };
  /** The endue ID the brain thinks with (ADR 0089); hosts without one leave it out. */
  account?: {
    status(): Promise<AccountStatus>;
    signIn(): Promise<AccountStatus>;
    signOut(): Promise<AccountStatus>;
    /** Hear every change, a sign-in finishing in the browser among them; returns the unsubscribe. */
    onChange(listener: (status: AccountStatus) => void): () => void;
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
