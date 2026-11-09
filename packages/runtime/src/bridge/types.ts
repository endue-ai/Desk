import type {
  A2ATaskList,
  A2ATaskStatus,
  AgentCard,
  AgentList,
  AgentStatus,
  AgentsImportResult,
  AgentsSessionsResult,
  AgentsTranscriptResult,
  BrainDesk,
  LocalAgent,
  LocalAgentAccess,
  LocalAgentId,
  LocalAgentRun,
  LocalAgentRunData,
  LocalAgentSource,
  SpaceList,
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioConversation,
  StudioSpace,
  StudioSpacesGetResult,
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

/** A brain the desk can choose for Eris (ADR 0094); claude is the person's Claude Code (ADR 0109). */
export type BrainName = "endue" | "local" | "echo" | "claude";

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

/** The desk's endue ID, as account.* answers it; no token ever reaches the runtime (ADR 0111). */
export interface AccountStatus {
  state: "signed-out" | "signing-in" | "signed-in";
  /** While signing in: the code the person confirms, the page it is on, and which page opened. */
  signIn?: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    screen?: "sign-in" | "sign-up";
  };
  /** While signed in: who, from the platform's /api/v1/users/me; the picture is a data: URL. */
  profile?: { displayName?: string; email?: string; avatarUrl?: string };
  /** Why the last step did not go through, in English. */
  problem?: string;
  /** Which kind of problem it was, for the runtime to word it. */
  reason?:
    | "offline"
    | "denied"
    | "expired"
    | "slow-down"
    | "unavailable"
    | "suspended"
    | "rejected"
    | "session-expired"
    | "failed";
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

/** Which sessions of a local agent, and one page of them (agents.sessions). */
export interface LocalSessionQuery {
  from?: LocalAgentSource;
  query?: string;
  offset?: number;
  limit?: number;
}

/** A work request to a local agent (agents.ask): new, or continuing `sessionId`. */
export interface LocalAsk {
  agent: LocalAgentId;
  prompt: string;
  sessionId?: string;
  /** A bridge path (`~/work/app`); the session's folder, else home, when absent. */
  cwd?: string;
  access?: LocalAgentAccess;
  model?: string;
}

/** What the core reports about local agents: a step of a run, or an agent whose imports changed. */
export type LocalAgentEvent =
  | { kind: "run"; data: LocalAgentRunData }
  | { kind: "changed"; agent: LocalAgentId };

/**
 * The agent programs on this computer, as the core finds and reads them (agents.*, ADR 0110):
 * Claude Code and Codex, their sessions from their own files, imports into the desk, and runs.
 */
export interface LocalAgentsBridge {
  list(): Promise<LocalAgent[]>;
  sessions(agent: LocalAgentId, query?: LocalSessionQuery): Promise<AgentsSessionsResult>;
  transcript(
    agent: LocalAgentId,
    sessionId: string,
    limit?: number,
  ): Promise<AgentsTranscriptResult>;
  import(
    agent: LocalAgentId,
    from: Exclude<LocalAgentSource, "desk">,
    sessionIds?: string[],
  ): Promise<AgentsImportResult>;
  ask(ask: LocalAsk): Promise<LocalAgentRun>;
  runs(agent?: LocalAgentId): Promise<LocalAgentRun[]>;
  stop(runId: string): Promise<LocalAgentRun>;
  /** Hear every run step and import; returns the unsubscribe. */
  onEvent(listener: (event: LocalAgentEvent) => void): () => void;
}

/**
 * The person's endue AI agents and spaces as the agent bar and their windows read them, once the
 * desk is signed in (studio.*, ADR 0122 and ADR 0129). The token stays in the core.
 */
export interface StudioShellBridge {
  /** Every agent of the person's that is not deleted, the newest first. */
  agents(): Promise<StudioAgent[]>;
  /** The most recently active conversations: which agents work, and which wait for the person. */
  conversations(): Promise<StudioConversation[]>;
  /** What Studio shows of one agent. */
  facets(agentId: string): Promise<StudioAgentsFacetsResult>;
  /** The spaces the person can open, the most recently active first. */
  spaces(): Promise<StudioSpace[]>;
  /** What one space is doing. */
  space(spaceId: string): Promise<StudioSpacesGetResult>;
  /** Open one of endue.ai's pages (an https URL) in the system browser. */
  open(url: string): Promise<void>;
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
    /**
     * One turn of Eris's loop: its hand-offs reach `onStep` as they happen, then the reply. `desk`
     * is what the person sees as they say it (ADR 0109), so Eris knows which plugin it is for.
     */
    say(text: string, onStep?: (step: BrainStep) => void, desk?: BrainDesk): Promise<BrainReply>;
  };
  /** The endue ID the brain thinks with (ADR 0089); hosts without one leave it out. */
  account?: {
    status(): Promise<AccountStatus>;
    /** Start signing in, on endue ID's sign-up page for `sign-up`; under way, open the page again. */
    signIn(screen?: "sign-in" | "sign-up"): Promise<AccountStatus>;
    signOut(): Promise<AccountStatus>;
    /** Hear every change, a sign-in finishing in the browser among them; returns the unsubscribe. */
    onChange(listener: (status: AccountStatus) => void): () => void;
  };
  /** The agent programs on this computer (ADR 0110); hosts without a core leave it out. */
  localAgents?: LocalAgentsBridge;
  /** The person's endue AI agents and spaces (ADR 0129); hosts without a core leave it out. */
  studio?: StudioShellBridge;
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
