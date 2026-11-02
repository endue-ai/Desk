/**
 * desk.describe for a setting (describe-variable): the value in force, the layer that set it, every
 * layer that holds one (manifest default < init.yaml < profile < session, as `Settings` resolves
 * them; ADR 0017) and the values a layer holds that do not fit and are skipped.
 */
import type { SettingContribution } from "@endue-ai/bridge";
import { fits, type Layer } from "../settings";
import {
  type Description,
  described,
  type Fact,
  type Facts,
  layerName,
  manifestFile,
  orList,
  pluginLabel,
  pluginWithFolder,
} from "./words";

/** Lowest first, as they layer. */
const LAYERS: readonly Layer[] = ["init", "profile", "session"];

interface Held {
  layer: Layer;
  value: unknown;
  fits: boolean;
}

/** What each layer holds for `key`, lowest first, and whether it fits the declaration. */
function held(key: string, f: Facts): Held[] {
  const declared = f.declared[key];
  return LAYERS.filter((layer) => key in f.layers[layer]).map((layer) => {
    const value = f.layers[layer][key];
    return { layer, value, fits: fits(declared, value) };
  });
}

/** The highest layer whose value for `key` fits, if any does. */
export function settingInForce(key: string, f: Facts): Held | undefined {
  return held(key, f)
    .reverse()
    .find((h) => h.fits);
}

const json = (value: unknown) => JSON.stringify(value);

/** "a string: system, light or dark", "an integer". */
function kindWords(setting: SettingContribution): string {
  switch (setting.kind) {
    case "string":
      return setting.choices ? `a string: ${orList(setting.choices)}` : "a string";
    case "integer":
      return "an integer";
    case "number":
      return "a number";
    case "boolean":
      return "true or false";
    case "array":
      return "a list";
    case "object":
      return "an object";
  }
}

/** Why a value is skipped: "not system, light or dark", "not an integer". */
function misfit(setting: SettingContribution | undefined): string {
  if (setting?.kind === "string" && setting.choices) return `not ${orList(setting.choices)}`;
  return setting ? `not ${kindWords(setting)}` : "";
}

export function explainSetting(key: string, f: Facts): Description {
  const declared = f.declared[key];
  const layers = held(key, f);
  if (!declared && layers.length === 0)
    throw new Error(`No setting ${key}: no plugin declares it and no layer sets it.`);
  const inForce = settingInForce(key, f);
  const value = inForce ? inForce.value : declared?.default;
  const summary = inForce
    ? `${key} is ${json(value)}, set in ${layerName(inForce.layer, f)}.`
    : `${key} is ${json(value)}, the manifest default.`;
  const owner = declared?.owner;
  const lines: Fact[] = [
    {
      label: "What it is",
      value: declared ? `a setting, ${kindWords(declared)}` : "a setting no plugin declares",
    },
  ];
  if (declared?.description) lines.push({ label: "What it does", value: declared.description });
  if (owner) lines.push({ label: "Plugin", value: pluginWithFolder(owner, f) });
  let layer = owner ? `manifest default, ${pluginLabel(owner, f)}` : "manifest default";
  if (inForce?.layer === "init") layer = f.initFile ? `init.yaml, ${f.initFile}` : "init.yaml";
  else if (inForce) layer = layerName(inForce.layer, f);
  lines.push({ label: "Layer", value: layer });
  const all = [
    ...(declared ? [`manifest default ${json(declared.default)}`] : []),
    ...layers.map(
      (h) =>
        `${layerName(h.layer, f)} ${json(h.value)}${h.fits ? "" : ` (skipped: ${misfit(declared)})`}`,
    ),
  ];
  lines.push({ label: "Layers", value: all.join("; ") });
  if (owner && !owner.startsWith("desk.")) {
    lines.push({
      label: "Note",
      value: `${owner} reads its value from the core, where init.yaml's ${key} or a value it set itself comes over this default (ADR 0031)`,
    });
  }
  lines.push({ label: "Who may change it", value: "you, in init.yaml, a profile or this session" });
  const file = inForce?.layer === "init" && f.initFile ? f.initFile : manifestFile(owner, f);
  if (file) lines.push({ label: "File", value: file });
  return described("setting", key, summary, lines, file);
}
