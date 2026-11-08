/**
 * The closed-window log as the shell's storage keeps it (ADR 0124): `{ version: 1, closed: [...] }`,
 * the last closed first. An entry that is not one is left out; anything else reads as no log.
 */
import type { SurfacePlacement } from "../modes/types";
import type { ClosedWindow } from "./closed";

const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

function readEntry(value: unknown): ClosedWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const e = value as Partial<ClosedWindow>;
  const p = e.placement as Partial<SurfacePlacement> | undefined;
  if (typeof e.id !== "string" || !e.id || typeof e.title !== "string") return undefined;
  if (!finite(e.at) || !strings(e.plugins) || !strings(e.views)) return undefined;
  if (!p || typeof p !== "object" || p.id !== e.id || typeof p.plugin !== "string")
    return undefined;
  if (![p.x, p.y, p.w, p.h].every(finite)) return undefined;
  if (e.desktop !== undefined && typeof e.desktop !== "string") return undefined;
  if (e.plugin !== undefined && typeof e.plugin !== "string") return undefined;
  return e as ClosedWindow;
}

export function readLog(value: unknown, max: number): ClosedWindow[] {
  if (!value || typeof value !== "object") return [];
  const { version, closed } = value as { version?: unknown; closed?: unknown };
  if (version !== 1 || !Array.isArray(closed)) return [];
  return closed.flatMap((e) => readEntry(e) ?? []).slice(0, max);
}
