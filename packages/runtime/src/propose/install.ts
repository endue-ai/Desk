/**
 * desk.propose and desk.propose.undo in the desk's registry, as the runtime's own commands (ADR 0017,
 * 0073). `desk.propose { kind?, text? }` ("Make with Eris…") makes a view from a sentence; without
 * one it asks for it with desk.palette.pick. `desk.propose.undo { kind?, id? }` takes back what this
 * session applied, the last one by default: the inverse `cmd.undo` (#276) can point to.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import type { NoticeInput } from "../notify";
import { createAsker } from "./asker";
import { createProposals, type Eris } from "./pipeline";
import { viewKind } from "./view";

export interface InstallProposalsOptions {
  /** The core, as the runtime reaches it. */
  bridge: BridgeClient;
  commands: Commands;
  notify(input: NoticeInput): void;
  /** The profile in force. */
  profile(): string | undefined;
  /** Eris's soul text and pose, where the host has her (the shell). */
  eris?: Eris;
  /** Wall-clock milliseconds (default Date.now). */
  now?(): number;
}

const ASK = "Say what to make, for example: show my events this week as a board";

export function installProposals(options: InstallProposalsOptions): () => void {
  const { bridge, commands, eris } = options;
  const asker = createAsker(bridge, { onOffline: (text) => eris?.say(text) });
  const view = viewKind({
    bridge,
    commands: { run: (id, args) => commands.run(id, args) },
    now: options.now ?? (() => Date.now()),
    profile: options.profile,
  });
  const proposals = createProposals({ asker, kinds: [view], notify: options.notify, eris });

  /** The sentence the person types into the palette, or "" when they back out. */
  const ask = async () => {
    const picked = await commands
      .run("desk.palette.pick", {
        title: "Make with Eris",
        placeholder: ASK,
        items: [],
        free: true,
      })
      .catch((error: { code?: string }) => {
        if (error.code === "cancelled") return "";
        throw error;
      });
    return typeof picked === "string" ? picked.trim() : "";
  };

  const offs = [
    commands.define("desk.propose", {
      title: "Make with Eris…",
      keywords: ["make", "build", "create", "view", "dashboard", "eris"],
      owner: "desk",
      run: async (args) => {
        const { kind = "view", text } = (args ?? {}) as { kind?: unknown; text?: unknown };
        const said = typeof text === "string" && text.trim() ? text.trim() : await ask();
        if (!said) return { status: "cancelled" };
        return proposals.propose(String(kind), said);
      },
    }),
    commands.define("desk.propose.undo", {
      title: "Undo what Eris made",
      keywords: ["undo", "eris", "view", "remove"],
      owner: "desk",
      run: (args) => {
        const { kind, id } = (args ?? {}) as { kind?: unknown; id?: unknown };
        return proposals.undo({
          ...(typeof kind === "string" ? { kind } : {}),
          ...(typeof id === "string" ? { id } : {}),
        });
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
