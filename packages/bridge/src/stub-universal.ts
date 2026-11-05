/**
 * What the browser stub checks before view.save keeps a universal view (ADR 0087, ADR 0102): an id
 * to name its file, a presentation it knows, one source, and the few limits a hand-made view breaks
 * most (`types` unique and holding `type`, `refresh` of 5 seconds or more). The core checks the
 * whole of universal.schema.json. Item views keep `viewProblems` (stub-views.ts).
 */
import type { AnyView, UniversalType, UniversalView, ViewSummary } from "./generated";
import { viewProblems } from "./stub-views";

export const UNIVERSAL_TYPES = [
  "timeline",
  "calendar",
  "kanban",
  "list",
  "text",
  "chat",
  "agent",
] as const satisfies readonly UniversalType[];
const SOURCES = ["data", "asset", "url", "file", "command", "items"];
const VIEW_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const TYPES: readonly string[] = UNIVERSAL_TYPES;

/** Whether a view is written as a universal view: a type or a source, and no layout. */
export function isUniversal(view: AnyView | Record<string, unknown>): view is UniversalView {
  const v = view as Record<string, unknown>;
  return v.layout === undefined && (v.type !== undefined || v.source !== undefined);
}

/** Why the stub would refuse a universal view, each `<pointer>: <what>`; none for one it keeps. */
export function universalProblems(view: UniversalView): string[] {
  const v = view as unknown as Record<string, unknown>;
  const problems: string[] = [];
  if (v.id === undefined) problems.push("/id: a universal view needs its id to be saved");
  else if (typeof v.id !== "string" || !VIEW_ID.test(v.id)) problems.push("/id: not a view id");
  if (!TYPES.includes(String(v.type)))
    problems.push(`/type: ${String(v.type)} is not a presentation`);
  const source = v.source as Record<string, unknown> | undefined;
  const keys = source && typeof source === "object" ? Object.keys(source) : [];
  const kinds = keys.filter((key) => SOURCES.includes(key));
  if (kinds.length !== 1) problems.push("/source: one of data, asset, url, file, command or items");
  if (v.types !== undefined) {
    const types = Array.isArray(v.types) ? v.types.map(String) : [];
    if (types.length === 0 || new Set(types).size !== types.length)
      problems.push("/types: one or more presentations, each once");
    else if (types.some((t) => !TYPES.includes(t))) problems.push("/types: unknown presentation");
  }
  if (v.refresh !== undefined && !(Number.isInteger(v.refresh) && Number(v.refresh) >= 5))
    problems.push("/refresh: 5 seconds or more");
  return problems.sort();
}

/** Why the stub would refuse a view in either language. */
export function anyViewProblems(view: AnyView): string[] {
  return isUniversal(view) ? universalProblems(view) : viewProblems(view);
}

/** The id a kept view is saved under. */
export const idOf = (view: AnyView): string => view.id ?? "";

/** view.list's line: an item view's version, a universal view's type and its id for a title. */
export function summaryOf(view: AnyView): ViewSummary {
  const described = view.description === undefined ? {} : { description: view.description };
  if (isUniversal(view))
    return {
      id: idOf(view),
      title: view.title ?? idOf(view),
      type: view.type,
      ...described,
      source: "file",
    };
  return { id: view.id, version: view.version, title: view.title, ...described, source: "file" };
}
