/**
 * desk.describe for a plugin (what it is, its folder, what it contributes and the grants it holds)
 * and for a grant: by its id, or every grant of a caller or of a permission. Grants come only when
 * the asker may list them itself (`Facts.grants`).
 */
import type { CallerGrant } from "@endue-ai/bridge";
import {
  callerLabel,
  commandPlugin,
  type Description,
  described,
  durationWords,
  type Fact,
  type Facts,
  manifestFile,
  permissionWords,
  plugin,
  pluginLabel,
  scopeText,
} from "./words";

const KIND_WORDS: Record<string, string> = {
  ui: "UI plugin",
  logic: "logic plugin",
  tool: "tool plugin",
  policy: "policy plugin",
  library: "library plugin",
  connector: "connector plugin",
  view: "view plugin",
  theme: "theme plugin",
};

const hidden = (f: Facts) => `not shown to ${f.asker ?? "the desk"}`;
const grantWords = (g: CallerGrant) =>
  `${permissionWords(g.grant.permission)}, ${durationWords(g.grant)}`;

export function explainPlugin(id: string, f: Facts): Description {
  const info = plugin(id, f);
  if (!info) throw new Error(`No plugin ${id} is installed.`);
  const manifest = info.manifest;
  const kind = KIND_WORDS[manifest?.kind ?? ""] ?? "plugin";
  const state = info.status === "failed" ? "failed" : info.enabled ? "on" : "off";
  const facts: string[] = [`version ${manifest?.version ?? "?"}`];
  if (info.builtIn) facts.push("built in");
  if (manifest?.autoload) facts.push("turned on when a file needs it");
  const lines: Fact[] = [{ label: "What it is", value: `a ${kind}, ${facts.join(", ")}` }];
  if (info.error) lines.push({ label: "Why it failed", value: info.error });
  if (manifest?.description) lines.push({ label: "What it does", value: manifest.description });
  if (info.folder) lines.push({ label: "Folder", value: info.folder });
  const commands = f.commands
    .filter((c) => commandPlugin(c.id, c.provider, f) === id)
    .map((c) => c.id)
    .sort();
  if (commands.length) lines.push({ label: "Commands", value: commands.join(", ") });
  const keys = f.keys.filter((k) => k.owner === id && k.command !== "");
  if (keys.length)
    lines.push({ label: "Keys", value: keys.map((k) => `${k.key} ${k.command}`).join(", ") });
  const settings = new Set([
    ...Object.entries(f.declared)
      .filter(([, setting]) => setting.owner === id)
      .map(([key]) => key),
    ...Object.keys(manifest?.contributes?.settings ?? {}),
  ]);
  if (settings.size) lines.push({ label: "Settings", value: [...settings].sort().join(", ") });
  let grants = hidden(f);
  if (f.grants) {
    const held = f.grants.filter((g) => g.caller === id);
    grants = held.length
      ? held.map((g) => `${g.grant.grantId} ${grantWords(g)}`).join("; ")
      : "none";
  }
  lines.push({ label: "Grants", value: grants });
  const file = manifestFile(id, f);
  if (file) lines.push({ label: "File", value: file });
  return described("plugin", id, `${pluginLabel(id, f)} is a ${kind}, ${state}.`, lines, file);
}

/** "always, kept in the desk's grant file; granted …". */
function duration(grant: CallerGrant["grant"]): string {
  const kept =
    grant.duration === "always"
      ? "always, kept in the desk's grant file"
      : grant.duration === "once"
        ? "once, spent by its first call"
        : "for this session";
  const ends = grant.expiresAt ? `; ends ${grant.expiresAt}` : "";
  return `${kept}; granted ${grant.grantedAt}${ends}`;
}

export function explainGrant(name: string, f: Facts): Description {
  if (!f.grants) throw new Error(`Grants are ${hidden(f)}: it does not hold perm:manage.`);
  const one = f.grants.find((g) => g.grant.grantId === name);
  if (one) {
    const { grant, caller } = one;
    const scope = scopeText(grant.permission);
    const of = `${grant.permission.permission}${scope ? ` (${scope})` : ""}`;
    const summary = `${name} lets ${caller} ${grantWords(one)}.`;
    return described("grant", name, summary, [
      { label: "What it is", value: `a grant of ${of}` },
      { label: "Who holds it", value: callerLabel(caller, f) },
      { label: "Duration", value: duration(grant) },
      { label: "Take it back", value: `desk perm revoke ${name}` },
    ]);
  }
  const plural = (n: number) => `${n} grant${n === 1 ? "" : "s"}`;
  const ofCaller = f.grants.filter((g) => g.caller === name);
  if (ofCaller.length) {
    const lines = ofCaller.map((g) => ({ label: g.grant.grantId, value: grantWords(g) }));
    const summary = `${callerLabel(name, f)} holds ${plural(ofCaller.length)}.`;
    return described("grant", name, summary, lines);
  }
  const ofPermission = f.grants.filter((g) => g.grant.permission.permission === name);
  if (ofPermission.length) {
    const lines = ofPermission.map((g) => ({
      label: g.grant.grantId,
      value: `${g.caller}, ${grantWords(g)}`,
    }));
    const callers = ofPermission.map((g) => g.caller).join(", ");
    const summary = `${plural(ofPermission.length)} of ${name}: ${callers}.`;
    return described("grant", name, summary, lines);
  }
  throw new Error(`No grant ${name}: no grant, caller or permission has that name.`);
}
