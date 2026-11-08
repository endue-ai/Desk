/**
 * desk.propose and desk.propose.undo in the desk's registry, as the runtime's own commands (ADR 0017,
 * 0073). `desk.propose { kind?, text? }` ("Make with Eris…") makes a view (a universal view; an item
 * view with `kind: "item-view"`), a profile or key bindings from a sentence (the kind the sentence
 * asks for when none is given) and answers with the outcome; without a sentence it asks for one
 * with desk.palette.pick and answers at once.
 * `desk.propose.undo { kind?, id? }` takes back what this session applied, the last one by default:
 * the inverse `cmd.undo` (#276) can point to. `desk.pack.setup { service }` proposes the pack for a
 * service ("Set up GitHub", ADR 0108).
 */
import type { BridgeClient } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import type { Platform } from "../input";
import type { NoticeInput } from "../notify";
import type { PolicySet } from "../policy";
import type { Settings } from "../settings";
import { createAsker } from "./asker";
import { createCard } from "./card";
import { keysKind, settingsKeys } from "./keys";
import { proposePack } from "./pack";
import { createProposals, type Eris, type ProposalKind } from "./pipeline";
import { profileKind } from "./profile";
import { kindOf } from "./talk";
import { universalKind } from "./universal";
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
  /**
   * Profiles and key bindings: the element their card goes in (inside the theme's tokens), the
   * settings and policies they change, the keymap's platform. Without it only views are proposed.
   */
  desk?: { host: HTMLElement; settings: Settings; policy(): PolicySet; platform: Platform };
}

const ASK =
  "Say what to make: show this repo's issues as a board, make a quiet profile, bind Mod+Shift+T to …";

export function installProposals(options: InstallProposalsOptions): () => void {
  const { bridge, commands, eris } = options;
  const asker = createAsker(bridge, { onOffline: (text) => eris?.say(text) });
  const views = {
    bridge,
    commands: { run: (id: string, args?: unknown) => commands.run(id, args) },
    now: options.now ?? (() => Date.now()),
    profile: options.profile,
  };
  // A view is a universal view (ADR 0102); the item view kind answers to its name only.
  const kinds: ProposalKind[] = [universalKind(views), viewKind({ ...views, kind: "item-view" })];
  const card = options.desk ? createCard(options.desk.host) : undefined;
  if (options.desk && card) {
    const { settings, policy, platform } = options.desk;
    const run = (id: string, args?: unknown) => commands.run(id, args);
    kinds.push(
      profileKind({ bridge, commands: { run }, settings, declared: () => policy().settings, card }),
      keysKind({
        keys: settingsKeys({ settings, policy, commands }, platform),
        commands: { run },
        card,
      }),
    );
  }
  const proposals = createProposals({ asker, kinds, notify: options.notify, eris });
  const kindFor = (kind: unknown, text: string) => (typeof kind === "string" ? kind : kindOf(text));

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
      keywords: [
        "make",
        "build",
        "create",
        "view",
        "board",
        "timeline",
        "dashboard",
        "profile",
        "bind",
        "keys",
        "eris",
      ],
      owner: "desk",
      run: async (args) => {
        const { kind, text } = (args ?? {}) as { kind?: unknown; text?: unknown };
        if (typeof text === "string" && text.trim())
          return proposals.propose(kindFor(kind, text), text.trim());
        // Asked from the palette: it cannot show its own pick while it waits for this command, so
        // the command answers at once and the rest goes on without the caller (desk.notify.history
        // does the same).
        void ask()
          .then((said) => (said ? proposals.propose(kindFor(kind, said), said) : undefined))
          .catch((error: unknown) =>
            options.notify({
              caller: "desk",
              title: "Eris could not make that",
              body: error instanceof Error ? error.message : String(error),
              level: "error",
            }),
          );
        return { status: "asking" };
      },
    }),
    commands.define("desk.propose.undo", {
      title: "Undo what Eris made",
      keywords: ["undo", "eris", "view", "profile", "keys", "remove"],
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
  // "Set up GitHub": a pack for the service, on the same card (ADR 0108). Needs the card.
  if (card)
    offs.push(
      commands.define("desk.pack.setup", {
        title: "Set up a service…",
        keywords: ["set up", "pack", "connect", "github", "service", "eris"],
        owner: "desk",
        run: (args) => {
          const { service } = (args ?? {}) as { service?: unknown };
          if (typeof service !== "string" || !service.trim())
            throw new Error("desk.pack.setup needs a service: github");
          const run = (id: string, more?: unknown) => commands.run(id, more);
          return proposePack({ bridge, commands: { run }, card, notify: options.notify }, service);
        },
      }),
    );
  return () => {
    for (const off of offs) off();
    card?.close();
  };
}
