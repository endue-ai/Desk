// The shell's host over the core: what mountDesk asks of its ShellBridge, answered with bridge calls
// as the runtime (`desk`). Audio levels are silent until the core captures audio.
import type {
  A2ATaskList,
  AgentCard,
  AgentList,
  BrainStatusResult,
  BrainTurnData,
  BridgeClient,
  Permission,
  SpaceList,
} from "@endue-ai/bridge";
import type { BrainStatus, ShellBridge } from "@endue-ai/runtime";

type BrainReply = Awaited<ReturnType<ShellBridge["brain"]["say"]>>;

const SCOPE = { permission: "brain:converse" } as const;
/** The shell's keys in the runtime's store, apart from the runtime's own (session, profiles). */
const PREFIX = "shell.";
const SILENT = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);

/** What the shell's scopes ask the core for, and why; scopes with no permission behind them are null. */
function permissionOf(scope: string): { permission: Permission; reason: string } | null {
  if (scope === "mic") {
    return {
      permission: { permission: "audio:capture" },
      reason: "Eris listens when you talk to her.",
    };
  }
  const path = scope.startsWith("fs.read:")
    ? scope.slice("fs.read:".length).replace(/\/+$/, "")
    : "";
  if (!path) return null;
  return {
    permission: { permission: "fs:read", paths: [`${path}/**`] },
    reason: `Eris reads the files in ${path} when you ask about them.`,
  };
}

/** The runtime's BrainStatus from the core's: credits the brain does not report count as none. */
function statusOf(status: BrainStatusResult): BrainStatus {
  return status.mode === "cloud" ? { mode: "cloud", credits: status.credits ?? 0 } : status;
}

/** A directory answer, which the bridge passes through as the brain contract's type. */
const passed = <T>(value: unknown) => value as T;

/** brain.say, then that turn's brain.turn events until it completes or fails: one reply. */
function say(core: BridgeClient, text: string): Promise<BrainReply> {
  return new Promise((resolve, reject) => {
    let turnId: string | undefined;
    let answer = "";
    let done = false;
    // Events can arrive before brain.say answers with the turn's id; they wait for it here.
    const early: BrainTurnData[] = [];
    const finish = (reply: BrainReply) => {
      done = true;
      off();
      resolve(reply);
    };
    const on = (data: BrainTurnData) => {
      if (done || data.turnId !== turnId) return;
      if (data.kind === "started") answer = "";
      else if (data.kind === "delta") answer += data.text ?? "";
      else if (data.kind === "completed") finish({ text: answer });
      else if (data.kind === "error") finish({ text: data.text ?? "" });
      // offline and online: the core retries, so the reply keeps waiting.
    };
    const off = core.onEvent((event) => {
      if (event.event !== "brain.turn") return;
      if (turnId === undefined) early.push(event.data);
      else on(event.data);
    });
    core.call("brain.say", { text, scope: SCOPE }).then(
      (result) => {
        turnId = result.turnId;
        for (const data of early.splice(0)) on(data);
      },
      (error: unknown) => {
        off();
        reject(error);
      },
    );
  });
}

export function shellBridge(core: BridgeClient): ShellBridge {
  const status = async () => statusOf(await core.call("brain.status", { scope: SCOPE }));
  return {
    storage: {
      async get<T>(key: string) {
        const { value } = await core.call("store.get", { key: PREFIX + key });
        return value as T | undefined;
      },
      async set(key, value) {
        await core.call("store.set", { key: PREFIX + key, value });
      },
    },
    perm: {
      async request(scope) {
        const asked = permissionOf(scope);
        if (!asked) return false;
        const { granted } = await core.call("perm.request", asked);
        return granted;
      },
    },
    audio: {
      levels: () => ({ user: SILENT, eris: SILENT }),
    },
    brain: {
      status,
      // Switching brains is not served yet: the desk keeps the brain it has.
      use: () => status(),
      say: (text) => say(core, text),
    },
    agents: {
      list: async (query) =>
        passed<AgentList>(await core.call("brain.agents.list", { ...query, scope: SCOPE })),
      card: async (agentId) =>
        passed<AgentCard>(await core.call("brain.agents.card", { agentId, scope: SCOPE })),
    },
    spaces: {
      list: async () => passed<SpaceList>(await core.call("brain.spaces.list", { scope: SCOPE })),
    },
    a2a: {
      tasks: async (query) =>
        passed<A2ATaskList>(await core.call("brain.tasks.list", { ...query, scope: SCOPE })),
    },
  };
}
