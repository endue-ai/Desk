// The shell's host over the core: what mountDesk asks of its ShellBridge, answered with bridge calls
// as the runtime (`desk`). Audio levels are silent; the microphone is audio.capture (ADR 0245). A
// turn's tool steps (Eris's errands, ADR 0089) reach the shell as they happen; account.* is the
// desk's endue ID, agents.* the agent programs on this computer (ADR 0110), and studio.* the
// person's endue agents and spaces once signed in (ADR 0129, shell-studio.ts).
import type {
  A2ATaskList,
  AgentCard,
  AgentList,
  BrainDesk,
  BrainStatusResult,
  BrainTurnData,
  BridgeClient,
  AccountStatus as CoreAccount,
  Permission,
  SpaceList,
} from "@endue-ai/bridge";
import type {
  AccountStatus,
  BrainStatus,
  BrainStep,
  LocalAgentsBridge,
  ShellBridge,
} from "@endue-ai/runtime";

type Audio = Required<ShellBridge["audio"]>;
type CaptureInForce = Parameters<Parameters<Audio["captures"]>[0]>[0][number];

import { studioShell } from "./shell-studio";

type BrainReply = Awaited<ReturnType<ShellBridge["brain"]["say"]>>;

const SCOPE = { permission: "brain:converse" } as const;
/** The runtime's settings that name a brain's model (desk-core's brain_choice.rs). */
const BRAIN_MODEL_KEYS = { local: "brain.model", claude: "brain.claude-model" } as const;
/** Where a sweep's snapshots go (ADR 0296). */
const SNAPSHOTS = "~/.desk/snapshots";
const ACCOUNT = { scope: { permission: "account:manage" } } as const;
const AGENTS = { scope: { permission: "agents:manage" } } as const;
const MIC = { permission: "audio:capture" } as const;
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
  if (status.mode !== "cloud") return status;
  const { credits, brain } = status;
  return { mode: "cloud", credits: credits ?? 0, ...(brain ? { brain } : {}) };
}

/** A directory answer, which the bridge passes through as the brain contract's type. */
const passed = <T>(value: unknown) => value as T;

/** The runtime's AccountStatus from the core's: the same fields, without when the code expires. */
function accountOf(status: CoreAccount): AccountStatus {
  const { state, signIn, profile, problem, reason } = status;
  return {
    state,
    ...(signIn
      ? {
          signIn: {
            userCode: signIn.userCode,
            verificationUri: signIn.verificationUri,
            verificationUriComplete: signIn.verificationUriComplete,
            ...(signIn.screen ? { screen: signIn.screen } : {}),
          },
        }
      : {}),
    ...(profile ? { profile: { ...profile } } : {}),
    ...(problem ? { problem } : {}),
    ...(reason ? { reason } : {}),
  };
}

/** A tool step of the turn, as the shell draws it. */
function stepOf(data: BrainTurnData): BrainStep | undefined {
  if ((data.kind !== "tool" && data.kind !== "tool-result") || !data.tool) return undefined;
  const { callId, command, provider, title, ok } = data.tool;
  return {
    kind: data.kind,
    callId,
    command,
    provider,
    ...(title ? { title } : {}),
    ...(ok === undefined ? {} : { ok }),
  };
}

/**
 * brain.say, with the desk the person sees when the runtime gives it (ADR 0109), then that turn's
 * brain.turn events until it completes or fails: one reply.
 */
function say(
  core: BridgeClient,
  text: string,
  onStep?: (step: BrainStep) => void,
  desk?: BrainDesk,
): Promise<BrainReply> {
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
      else {
        const step = stepOf(data);
        if (step) onStep?.(step);
      }
      // offline and online: the core retries, so the reply keeps waiting.
    };
    const off = core.onEvent((event) => {
      if (event.event !== "brain.turn") return;
      if (turnId === undefined) early.push(event.data);
      else on(event.data);
    });
    core.call("brain.say", { text, ...(desk ? { desk } : {}), scope: SCOPE }).then(
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

/** LINEAR16 little-endian from base64, as audio.frame carries it. */
function samplesOf(pcm: string): Int16Array {
  const bytes = Uint8Array.from(atob(pcm), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Int16Array.from({ length: bytes.length >> 1 }, (_, i) => view.getInt16(i * 2, true));
}

/**
 * The microphone as the runtime (ADR 0245): a capture with its frames and its end, and every
 * capture in force, followed from the start so a listener that comes later hears the list now.
 */
function microphone(core: BridgeClient): Pick<Audio, "capture" | "captures" | "stopCapture"> {
  const stopCapture = async (captureId: string) => {
    await core.call("audio.capture.stop", { captureId, scope: MIC });
  };
  let inForce: readonly CaptureInForce[] = [];
  const listeners = new Set<(captures: readonly CaptureInForce[]) => void>();
  core.onEvent((event) => {
    if (event.event !== "audio.capturing") return;
    inForce = event.data.captures;
    for (const listener of listeners) listener(inForce);
  });
  return {
    async capture(onFrame, onEnded) {
      let captureId: string;
      try {
        ({ captureId } = await core.call("audio.capture.start", { scope: MIC }));
      } catch {
        return null;
      }
      const off = core.onEvent((event) => {
        if (event.event === "audio.ended" && event.data.captureId === captureId) {
          off();
          onEnded?.();
          return;
        }
        if (event.event !== "audio.frame" || event.data.captureId !== captureId) return;
        const { pcm, sampleRate, rmsDb, peakDb, atMs } = event.data;
        onFrame({ samples: samplesOf(pcm), sampleRate, rmsDb, peakDb, atMs });
      });
      return {
        captureId,
        async stop() {
          off();
          await stopCapture(captureId).catch(() => {});
        },
      };
    },
    captures(listener) {
      listeners.add(listener);
      listener(inForce);
      return () => listeners.delete(listener);
    },
    stopCapture,
  };
}

/** agents.* as the runtime: every call under agents:manage, steps and imports as one listener. */
function localAgents(core: BridgeClient): LocalAgentsBridge {
  return {
    list: async () => (await core.call("agents.list", AGENTS)).agents,
    sessions: (agent, query = {}) => core.call("agents.sessions", { agent, ...query, ...AGENTS }),
    transcript: (agent, sessionId, limit) =>
      core.call("agents.transcript", {
        agent,
        sessionId,
        ...(limit === undefined ? {} : { limit }),
        ...AGENTS,
      }),
    import: (agent, from, sessionIds) =>
      core.call("agents.import", { agent, from, ...(sessionIds ? { sessionIds } : {}), ...AGENTS }),
    ask: async (ask) => (await core.call("agents.ask", { ...ask, ...AGENTS })).run,
    runs: async (agent) =>
      (await core.call("agents.runs", { ...(agent ? { agent } : {}), ...AGENTS })).runs,
    stop: async (runId) => (await core.call("agents.stop", { runId, ...AGENTS })).run,
    onEvent: (listener) =>
      core.onEvent((event) => {
        if (event.event === "agents.run") listener({ kind: "run", data: event.data });
        else if (event.event === "agents.changed")
          listener({ kind: "changed", agent: event.data.agent });
      }),
  };
}

export function shellBridge(core: BridgeClient): ShellBridge {
  const status = async () => statusOf(await core.call("brain.status", { scope: SCOPE }));
  return {
    user: {
      async info() {
        const { value } = await core.call(
          "store.get",
          { key: "first-run" },
          { caller: "endue.onboarding" },
        );
        const name = (value as { name?: unknown } | undefined)?.name;
        return typeof name === "string" && name.trim() ? { name: name.trim().slice(0, 24) } : {};
      },
    },
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
      ...microphone(core),
    },
    brain: {
      status,
      // The choice is the runtime's own setting, which the core reads every turn (ADR 0094).
      async use(brain) {
        await core.call("settings.set", { key: "brain.use", value: brain });
        return status();
      },
      // The local brain's model and Claude Code's, the runtime's settings too (ADR 0296).
      models: {
        async get() {
          const text = async (key: string) => {
            const { value } = await core
              .call("settings.get", { key })
              .catch((): { value?: unknown } => ({}));
            return typeof value === "string" ? value : "";
          };
          const [local, claude] = await Promise.all([
            text(BRAIN_MODEL_KEYS.local),
            text(BRAIN_MODEL_KEYS.claude),
          ]);
          return { local, claude };
        },
        async set(brain, model) {
          await core.call("settings.set", { key: BRAIN_MODEL_KEYS[brain], value: model });
        },
      },
      say: (text, onStep, desk) => say(core, text, onStep, desk),
    },
    // A sweep's snapshot (ADR 0296): windows' last frames, kept under ~/.desk/snapshots.
    snapshots: {
      async window(plugin, surface) {
        const shot = await core
          .call("ui.surface.snapshot", {
            plugin,
            ...(surface ? { surface } : {}),
            scope: { permission: "ui:surface" },
          })
          .catch(() => null);
        return shot && { image: shot.image, width: shot.width, height: shot.height };
      },
      async save(name, png) {
        const path = `${SNAPSHOTS}/${name.replace(/[^\w.-]/g, "-")}`;
        const scope = { permission: "fs:write" as const, paths: [`${SNAPSHOTS}/**`] };
        await core.call("fs.write", {
          path,
          content: png,
          encoding: "base64",
          createDirs: true,
          scope,
        });
        return path;
      },
    },
    account: {
      status: async () => accountOf(await core.call("account.status", ACCOUNT)),
      signIn: async (screen) =>
        accountOf(await core.call("account.signIn", screen ? { ...ACCOUNT, screen } : ACCOUNT)),
      signOut: async () => accountOf(await core.call("account.signOut", ACCOUNT)),
      onChange: (listener) =>
        core.onEvent((event) => {
          if (event.event === "account.changed") listener(accountOf(event.data));
        }),
    },
    localAgents: localAgents(core),
    studio: studioShell(core),
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
