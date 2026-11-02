/**
 * Key bindings as a kind Eris proposes (ADR 0073): `{ bindings: KeyBinding[] }`, each a
 * `KeyBinding` of specs/plugin/v0 for a command the desk has. The card shows them as a table with
 * each conflict marked (`keys-table.ts`), never refused: a key another command has in any layer, two
 * proposals on one key, a binding that is already there. Apply adds them to the person's layer of the
 * keymap, replacing the person's own entries on those keys; Undo puts the layer back exactly.
 *
 * The keymap is reached through one port, `PersonalKeys`. `settingsKeys` is the port over the
 * runtime: the core's default keys and every plugin's, then the setting desk.keys.bindings, as the
 * keyboard settings write it (ADR 0055) and desk.keys keeps it in ~/.desk/keys.yaml (ADR 0079).
 */
import type { KeyBinding } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import { DEFAULT_KEYS } from "../core/keys";
import { canonical, formatCombo, type Platform } from "../input";
import { resolveKeymap } from "../keymap";
import { PERSONAL_KEYS } from "../policies/keys";
import type { PolicySet } from "../policy";
import type { Settings } from "../settings";
import type { AskTool } from "./asker";
import type { Card, CardContent } from "./card";
import type { KeyMark, KeyRow } from "./keys-table";
import type { Applied, ProposalKind, Request } from "./pipeline";
import type { Schemas } from "./schema";
import { KEYS, specSchemas } from "./specs";

export interface PersonalKeys {
  platform: Platform;
  /** The core's and every plugin's bindings in layer order, the person's not included. */
  contributed(): PolicySet["keys"];
  /** The person's layer in force. */
  personal(): KeyBinding[];
  /** Replace the person's layer; what it returns puts the layer back exactly as it was. */
  write(personal: KeyBinding[]): () => void;
  /** Every command the desk knows: what the plugins that are on contribute and the registry. */
  commands(): Array<{ id: string; title: string; keywords?: string[] }>;
}

export interface KeyBindings {
  bindings: KeyBinding[];
}

const isBinding = (value: unknown): value is KeyBinding =>
  typeof (value as KeyBinding | null)?.key === "string" &&
  typeof (value as KeyBinding).command === "string";

/** The port over today's runtime: the session layer of the setting desk.keys.bindings. */
export function settingsKeys(
  desk: { settings: Settings; policy(): PolicySet; commands: Pick<Commands, "list"> },
  platform: Platform,
): PersonalKeys {
  const { settings } = desk;
  return {
    platform,
    contributed: () => [...DEFAULT_KEYS, ...desk.policy().keys],
    personal: () => {
      const value = settings.get<unknown>(PERSONAL_KEYS, []);
      return Array.isArray(value) ? value.filter(isBinding) : [];
    },
    write(personal) {
      const layer = settings.layer("session");
      const had = PERSONAL_KEYS in layer;
      const was = layer[PERSONAL_KEYS];
      settings.set(PERSONAL_KEYS, personal);
      return () => (had ? settings.set(PERSONAL_KEYS, was) : settings.reset(PERSONAL_KEYS));
    },
    commands: () => {
      const byId = new Map<string, { id: string; title: string; keywords?: string[] }>();
      for (const { id, title, keywords } of desk.policy().commands)
        byId.set(id, { id, title, ...(keywords ? { keywords } : {}) });
      for (const { id, title, keywords } of desk.commands.list())
        byId.set(id, { id, title, keywords });
      return [...byId.values()];
    },
  };
}

const GUIDE = [
  'Each binding binds one key to one command: {"key": "Mod+Shift+T", "command": "endue.terminal.focus"}.',
  "A key is modifiers (Mod, Control, Alt, Shift) and one key joined with +; Mod is Command on macOS",
  'and Control elsewhere. Use the commands the desk lists, by id; "command": "" takes a key away.',
  "A key another command has moves to the new one: the desk shows that before it applies.",
].join(" ");
/** Words that say nothing about which command is meant. */
const STOP = new Set(
  "bind binds the and with for key keys that this from into onto when make press shortcut".split(
    " ",
  ),
);
const CHORD = /^(?:(?:Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)+[^+\s]+$/i;
/** How many commands the context names. */
const LISTED = 20;

export interface KeysKindOptions {
  keys: PersonalKeys;
  /** desk.propose.undo, through the registry (the card's Undo). */
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  card: Card;
  schemas?: Schemas;
}

export function keysKind(options: KeysKindOptions): ProposalKind<KeyBindings> {
  const { keys, commands, card } = options;
  const { platform } = keys;
  let schemas: Schemas | undefined;
  let tool: AskTool | undefined;
  let compact: Record<string, unknown> | undefined;
  let last: { value: KeyBindings; content: Extract<CardContent, { kind: "keys" }> } | undefined;
  const restores = new Map<string, () => void>();
  let made = 0;
  const specs = () => {
    schemas ??= options.schemas ?? specSchemas();
    return schemas;
  };
  const comboOf = (binding: KeyBinding) =>
    canonical(platform === "mac" && binding.mac ? binding.mac : binding.key, platform);
  const layers = () => [
    ...keys.contributed(),
    ...keys.personal().map((binding) => ({ ...binding, owner: "person" })),
  ];

  /** The card's table: each binding as people read it, what its key runs now, and its marks. */
  const contentOf = (value: KeyBindings) => {
    const all = layers();
    const force = resolveKeymap(all, platform);
    const titles = new Map(keys.commands().map((c) => [c.id, c.title]));
    const title = (id: string) => titles.get(id) ?? id;
    const counts = new Map<string, number>();
    for (const binding of value.bindings)
      counts.set(comboOf(binding), (counts.get(comboOf(binding)) ?? 0) + 1);
    const rows = value.bindings.map((binding): KeyRow => {
      const combo = comboOf(binding);
      const now = force.find((b) => b.combo === combo);
      const other = all.findLast(
        (b) => comboOf(b) === combo && b.command !== "" && b.command !== binding.command,
      );
      const holder = now ?? other;
      const marks: KeyMark[] = [];
      if (now ? now.command !== binding.command : other) marks.push("taken");
      if ((counts.get(combo) ?? 0) > 1) marks.push("twice");
      if (now?.command === binding.command) marks.push("same");
      return {
        key: formatCombo(combo, platform),
        combo,
        command: binding.command,
        title: binding.command ? title(binding.command) : "",
        ...(holder
          ? { now: { command: holder.command, title: title(holder.command), owner: holder.owner } }
          : {}),
        marks,
      };
    });
    const [row] = rows;
    const heading =
      rows.length === 1 && row
        ? `${row.key} → ${row.title || "nothing"}`
        : `${rows.length} key bindings`;
    const content = { kind: "keys" as const, title: heading, rows };
    last = { value, content };
    return content;
  };

  return {
    kind: "keys",
    noun: "key binding",
    guide: GUIDE,
    tool() {
      tool ??= {
        name: "propose_key_bindings",
        description:
          "Propose key bindings (KeyBinding of specs/plugin/v0) for the person's layer of the keymap: which key runs which command.",
        schema: specs().bundle(KEYS),
      };
      return tool;
    },
    compact() {
      compact ??= specs().bundle(KEYS, { compact: true });
      return compact;
    },

    /** The commands the sentence's words match (at most 20), and the keys in force for them. */
    async context(request: Request) {
      const text = [request.text, ...request.corrections].join(" ");
      const tokens = text.split(/\s+/).map((t) => t.replace(/[.,;:!?"“”]+$/, ""));
      const chords = tokens.filter((t) => CHORD.test(t)).map((t) => canonical(t, platform));
      const words = [
        ...new Set(
          tokens
            .filter((t) => !CHORD.test(t))
            .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
            .filter((w) => w.length >= 3 && !STOP.has(w)),
        ),
      ];
      const all = keys.commands();
      const score = (c: { id: string; title: string; keywords?: string[] }) => {
        const hay = [c.id, c.title, ...(c.keywords ?? [])].join(" ").toLowerCase();
        return words.filter((w) => hay.includes(w)).length;
      };
      const matched = all
        .map((c, i) => ({ c, i, s: score(c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.c);
      const listed = (matched.length ? matched : all).slice(0, LISTED);
      const ids = new Set(listed.map((c) => c.id));
      const bound = resolveKeymap(layers(), platform)
        .filter((b) => ids.has(b.command) || chords.includes(b.combo))
        .map((b) => ({ key: b.combo, command: b.command }));
      return {
        platform:
          platform === "mac" ? "macOS: Mod is Command" : "Windows and Linux: Mod is Control",
        commands: listed.map(({ id, title }) => ({ id, title })),
        bound,
      };
    },

    async check(answer) {
      if (typeof answer !== "object" || answer === null || Array.isArray(answer))
        return { problems: ["/: the answer is not a JSON object"] };
      const problems = specs().validate(answer, KEYS);
      if (problems.length) return { problems };
      const { bindings } = answer as KeyBindings;
      const known = new Set(keys.commands().map((c) => c.id));
      bindings.forEach(({ command }, i) => {
        if (command && !known.has(command))
          problems.push(`/bindings/${i}/command: the desk has no command ${command}`);
      });
      return problems.length ? { problems } : { value: { bindings } };
    },

    async preview(value, request) {
      return card.preview(contentOf(value), `Eris made this from “${request.text}”.`);
    },

    async dismiss() {
      card.close();
    },

    async apply(value): Promise<Applied> {
      const content = last?.value === value ? last.content : contentOf(value);
      const before = keys.personal();
      const chords = new Set(value.bindings.map(comboOf));
      const restore = keys.write([
        ...before.filter((binding) => !chords.has(comboOf(binding))),
        ...value.bindings,
      ]);
      const id = `keys-${++made}`;
      restores.set(id, restore);
      const { rows } = content;
      const [row] = rows;
      const one = rows.length === 1 && row;
      card.applied(
        content,
        one ? "Eris changed this key binding." : "Eris changed these key bindings.",
        () => commands.run("desk.propose.undo", { kind: "keys", id }),
      );
      return {
        id,
        title: content.title,
        where: "desk.keys.bindings",
        line: one
          ? row.command
            ? `I bound ${row.key} to ${row.title}.`
            : `I took ${row.key} away.`
          : `I changed ${rows.length} key bindings.`,
        before,
      };
    },

    async undo({ id }) {
      const restore = restores.get(id);
      if (!restore) throw new Error(`Nothing to put back for ${id}.`);
      restore();
      restores.delete(id);
      card.close();
    },
  };
}
