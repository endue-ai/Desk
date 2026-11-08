/**
 * desk.describe (RT-06; Emacs's describe-key, describe-function and describe-variable): what a key,
 * command, setting, plugin or grant is, in words: what it is, which plugin contributes it, which
 * layer set it, what it does, who may call it and its undo. Plain data in, plain data out, so it is
 * tested without a DOM: `install.ts` gathers the facts and shows the answer, and the CLI prints its
 * text (ADR 0075).
 */
import { canonical, formatCombo } from "../input";
import { globMatch } from "../policy";
import {
  type Conflict,
  continuations,
  type Resolved,
  resolveBindings,
} from "../sequences/conflicts";
import { chordsOf } from "../sequences/parse";
import { explainGrant, explainPlugin } from "./grants";
import { explainSetting, settingInForce } from "./setting";
import {
  commandPlugin,
  type DescribeKind,
  type Description,
  described,
  type Fact,
  type Facts,
  layerName,
  manifestFile,
  pluginLabel,
  pluginWithFolder,
} from "./words";

export type { DescribeKind, Description, Facts } from "./words";
export { KINDS } from "./words";

/** Describe one thing; throws a sentence when there is no such thing. */
export function explain(kind: DescribeKind, name: string, f: Facts): Description {
  switch (kind) {
    case "key":
      return explainKey(name, f);
    case "command":
      return explainCommand(name, f);
    case "setting":
      return explainSetting(name, f);
    case "plugin":
      return explainPlugin(name, f);
    case "grant":
      return explainGrant(name, f);
  }
}

/** Who may run a command: the person always; callers by their cmd:invoke grants, when shown. */
export function whoMayCall(id: string, f: Facts): string {
  const you = "you, with its keys or the palette";
  if (!f.grants) return `${you}; grants are not shown to ${f.asker ?? "the desk"}`;
  const covers = (pattern: string) => globMatch(pattern, id);
  const callers = f.grants
    .filter((g) => g.grant.permission.permission === "cmd:invoke")
    .filter((g) => (g.grant.permission as { ids: string[] }).ids.some(covers))
    .map((g) => g.caller);
  const unique = [...new Set(callers)].sort();
  return unique.length
    ? `${you}; with a cmd:invoke grant: ${unique.join(", ")}`
    : `${you}; no caller holds a cmd:invoke grant for it`;
}

/** The layer a binding comes from, in words, and the file behind it. */
function bindingLayer(owner: string, f: Facts): { long: string; short: string; file?: string } {
  // The runtime's own keys (ADR 0055) come before every plugin's and have no manifest.
  if (owner === "desk") return { long: "core default, desk", short: "core default" };
  if (owner !== "person") {
    const file = manifestFile(owner, f);
    return {
      long: `manifest default, ${pluginLabel(owner, f)}`,
      short: `manifest default, ${owner}`,
      ...(file ? { file } : {}),
    };
  }
  const layer = settingInForce("desk.keys.bindings", f)?.layer ?? "session";
  const text = `${layerName(layer, f)}, your desk.keys.bindings`;
  const declaring = f.declared["desk.keys.bindings"]?.owner;
  const file = layer === "init" && f.initFile ? f.initFile : manifestFile(declaring, f);
  return { long: text, short: text, ...(file ? { file } : {}) };
}

/** The combo a binding is for on this platform (a binding's `mac` key replaces `key` on macOS). */
const comboOf = (binding: Facts["keys"][number], f: Facts) =>
  canonical(f.platform === "mac" && binding.mac ? binding.mac : binding.key, f.platform);

function explainKey(name: string, f: Facts): Description {
  const combo = canonical(name, f.platform);
  const chords = chordsOf(combo);
  const shown = formatCombo(combo, f.platform);
  const kind = chords.length > 1 ? "the key sequence" : "the key";
  const what: Fact = { label: "What it is", value: `${kind} ${shown} (${combo})` };
  // Keys are sequences resolved by precedence (ADR 0118): the one in force, else the last to lose.
  const { bindings, conflicts } = resolveBindings(f.keys, f.platform);
  const entries = f.keys.flatMap((binding, index) =>
    comboOf(binding, f) === combo ? [{ binding, index }] : [],
  );
  const at = bindings.find((b) => b.combo === combo)?.index ?? entries.at(-1)?.index;
  const last = at === undefined ? undefined : f.keys[at];
  const under = continuations(bindings, chords);
  const keyOf = (b: Resolved) =>
    `${formatCombo(b.combo, f.platform)} → ${b.command} (${bindingLayer(b.owner, f).short})`;
  const continues: Fact[] = under.length
    ? [{ label: "Continues with", value: under.map(keyOf).join(", ") }]
    : [];
  if (!last || last.command === "") {
    if (under.length) {
      const prefix: Fact = { label: "What it is", value: `the prefix ${shown} (${combo})` };
      const count = `${under.length} key${under.length === 1 ? "" : "s"}`;
      return described("key", combo, `${shown} is a prefix of ${count}.`, [prefix, ...continues]);
    }
    const lines = last
      ? [what, { label: "Layer", value: bindingLayer(last.owner, f).long }]
      : [what];
    return described("key", combo, `${shown} is not bound.`, lines);
  }
  const mine = (c: Conflict) => c.binding.index === at;
  const lost = conflicts.find((c) => mine(c) && !c.bound && c.kind !== "duplicate");
  const command = f.commands.find((c) => c.id === last.command);
  let summary = command
    ? `${shown} runs ${last.command}.`
    : `${shown} runs ${last.command}, which is not available now.`;
  if (lost?.by)
    summary = `${shown} would run ${last.command}, but ${formatCombo(lost.by.combo, f.platform)} shadows it.`;
  if (lost?.reserved)
    summary = `${shown} never runs ${last.command}: ${formatCombo(lost.reserved.chord, f.platform)} ${lost.reserved.does}.`;
  const lines: Fact[] = [what];
  if (command) lines.push({ label: "What it does", value: command.description ?? command.title });
  const owner = commandPlugin(last.command, command?.provider, f);
  if (owner) lines.push({ label: "Plugin", value: pluginWithFolder(owner, f) });
  const layer = bindingLayer(last.owner, f);
  lines.push({ label: "Layer", value: layer.long });
  const earlier = entries.filter(({ binding, index }) => index !== at && binding.command !== "");
  if (earlier.length) {
    const replaced = earlier.map(
      ({ binding: b }) => `${b.command} (${bindingLayer(b.owner, f).short})`,
    );
    lines.push({ label: "Replaces", value: replaced.join(", ") });
  }
  if (lost?.by) lines.push({ label: "Shadowed by", value: keyOf(lost.by) });
  const shadows = conflicts.filter((c) => c.kind === "shadowed" && c.by?.index === at);
  if (shadows.length)
    lines.push({ label: "Shadows", value: shadows.map((c) => keyOf(c.binding)).join(", ") });
  lines.push(...continues);
  const held = conflicts.find((c) => mine(c) && c.kind === "reserved" && c.bound)?.reserved;
  if (held)
    lines.push({
      label: "Reserved",
      value: `${held.by} keeps ${formatCombo(held.chord, f.platform)} (it ${held.does})`,
    });
  if (command) lines.push({ label: "Who may call it", value: whoMayCall(last.command, f) });
  if (layer.file) lines.push({ label: "File", value: layer.file });
  return described("key", combo, summary, lines, layer.file);
}

function explainCommand(id: string, f: Facts): Description {
  const command = f.commands.find((c) => c.id === id);
  if (!command) throw new Error(`No command ${id}: nothing provides it now.`);
  const owner = commandPlugin(id, command.provider, f);
  const summary = owner
    ? `${id} is a command of ${pluginLabel(owner, f)}.`
    : `${id} is a command of the desk itself.`;
  let what = `a command ${command.provider} provides`;
  if (command.provider === "desk")
    what = owner
      ? `a command the desk provides while ${owner} is on`
      : "a command the desk provides";
  const lines: Fact[] = [
    { label: "What it is", value: what },
    { label: "What it does", value: command.description ?? command.title },
  ];
  if (command.undo) lines.push({ label: "Undo", value: command.undo });
  if (owner) lines.push({ label: "Plugin", value: pluginWithFolder(owner, f) });
  // The bindings in force, sequences resolved by precedence (ADR 0118), in layer order.
  const inForce = new Set(resolveBindings(f.keys, f.platform).bindings.map((b) => b.index));
  const keys = f.keys
    .map((binding, i) => ({ binding, combo: comboOf(binding, f), i }))
    .filter(({ i }) => inForce.has(i))
    .filter(({ binding }) => binding.command === id)
    .map(({ binding, combo }) => {
      const layer = bindingLayer(binding.owner, f).short;
      return `${formatCombo(combo, f.platform)} (${layer})`;
    });
  if (keys.length) lines.push({ label: "Keys", value: keys.join(", ") });
  lines.push({ label: "Who may call it", value: whoMayCall(id, f) });
  const file = manifestFile(owner, f);
  if (file) lines.push({ label: "File", value: file });
  return described("command", id, summary, lines, file);
}
