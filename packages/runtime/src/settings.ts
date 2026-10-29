/**
 * Settings in layers (ADR 0017): the defaults plugins declare, init.yaml, the active profile, then
 * changes made while Desk runs. A value of the wrong kind is skipped, so the layer below shows through.
 */
import type { SettingContribution } from "@endue-ai/bridge";

export type Layer = "init" | "profile" | "session";
const ORDER: readonly Layer[] = ["session", "profile", "init"];

type Values = Record<string, unknown>;

export class Settings {
  #defaults: Record<string, SettingContribution> = {};
  readonly #layers: Record<Layer, Values> = { init: {}, profile: {}, session: {} };
  readonly #listeners = new Set<(keys: string[]) => void>();
  /** Values skipped because they do not fit their setting, for people. */
  readonly problems: string[] = [];

  setDefaults(defaults: Record<string, SettingContribution>): void {
    const before = this.all();
    this.#defaults = { ...defaults };
    this.#emit(before);
  }

  /** Replace one layer whole (init.yaml read again, another profile, a fresh session). */
  setLayer(layer: Layer, values: Values): void {
    const before = this.all();
    this.#layers[layer] = { ...values };
    this.#emit(before);
  }

  /** A change made while Desk runs: it lasts until Desk quits unless a profile saves it. */
  set(key: string, value: unknown): void {
    const before = this.all();
    this.#layers.session = { ...this.#layers.session, [key]: value };
    this.#emit(before);
  }

  /** Forget a session change, so init.yaml or the profile shows through again. */
  reset(key: string): void {
    const before = this.all();
    const { [key]: _gone, ...rest } = this.#layers.session;
    this.#layers.session = rest;
    this.#emit(before);
  }

  layer(layer: Layer): Values {
    return { ...this.#layers[layer] };
  }

  get<T = unknown>(key: string, fallback?: T): T {
    for (const layer of ORDER) {
      const values = this.#layers[layer];
      if (key in values && fits(this.#defaults[key], values[key])) return values[key] as T;
    }
    const declared = this.#defaults[key];
    return (declared ? declared.default : fallback) as T;
  }

  /** Every declared setting with the value in force, plus undeclared keys some layer sets. */
  all(): Values {
    const keys = new Set([
      ...Object.keys(this.#defaults),
      ...ORDER.flatMap((layer) => Object.keys(this.#layers[layer])),
    ]);
    return Object.fromEntries([...keys].sort().map((key) => [key, this.get(key)]));
  }

  /** Hear which keys changed value. */
  onChange(listener: (keys: string[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(before: Values): void {
    const after = this.all();
    this.problems.length = 0;
    for (const layer of ORDER) {
      for (const [key, value] of Object.entries(this.#layers[layer])) {
        if (!fits(this.#defaults[key], value))
          this.problems.push(`${layer}: ${key} is not a ${this.#defaults[key]?.kind}`);
      }
    }
    const keys = Object.keys({ ...before, ...after }).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    if (keys.length > 0) for (const listener of this.#listeners) listener(keys);
  }
}

/** Whether `value` is of the declared kind (and one of its choices); undeclared keys take anything. */
export function fits(setting: SettingContribution | undefined, value: unknown): boolean {
  if (!setting) return true;
  switch (setting.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string" && (!setting.choices || setting.choices.includes(value));
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
