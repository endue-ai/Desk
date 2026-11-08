/**
 * What the browser stub checks before view.save keeps a universal view (ADR 0087, ADR 0102): an id
 * to name its file, a presentation it knows, one source, and the few limits a hand-made view breaks
 * most (`types` unique and holding `type`, `refresh` of 5 seconds or more). The core checks the
 * whole of universal.schema.json. Item views keep `viewProblems` (stub-views.ts).
 */
import type {
  AnyView,
  UniversalPage,
  UniversalType,
  UniversalView,
  View,
  ViewSummary,
} from "./generated";
import { viewProblems } from "./stub-views";

export const UNIVERSAL_TYPES = [
  "timeline",
  "calendar",
  "kanban",
  "list",
  "text",
  "chat",
  "agent",
  "chart",
  "stat",
  "detail",
] as const satisfies readonly UniversalType[];
const SOURCES = ["data", "asset", "url", "file", "command", "items"];
const VIEW_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const TYPES: readonly string[] = UNIVERSAL_TYPES;

/** Whether a view is written as a universal view: a type or a source, and no layout. */
export function isUniversal(view: AnyView | Record<string, unknown>): view is UniversalView {
  const v = view as Record<string, unknown>;
  return v.layout === undefined && (v.type !== undefined || v.source !== undefined);
}

/** Whether a view is a page of universal views (ADR 0103): sections, and no layout. */
export function isPage(view: AnyView | Record<string, unknown>): view is UniversalPage {
  const v = view as Record<string, unknown>;
  return v.layout === undefined && v.sections !== undefined;
}

/** Why the stub would refuse a page: its id, and each section as a universal view of its own. */
export function pageProblems(page: UniversalPage): string[] {
  const v = page as unknown as Record<string, unknown>;
  const problems = idProblems(v, "a page");
  const sections = Array.isArray(v.sections) ? v.sections : [];
  if (sections.length === 0) problems.push("/sections: one section or more");
  sections.forEach((section, i) => {
    const s = (section ?? {}) as Record<string, unknown>;
    for (const own of ["id", "params", "provenance"])
      if (s[own] !== undefined) problems.push(`/sections/${i}/${own}: the page's, not a section's`);
    for (const why of shapeProblems(s)) problems.push(`/sections/${i}${why}`);
  });
  return problems.sort();
}

function idProblems(v: Record<string, unknown>, what: string): string[] {
  if (v.id === undefined) return [`/id: ${what} needs its id to be saved`];
  return typeof v.id !== "string" || !VIEW_ID.test(v.id) ? ["/id: not a view id"] : [];
}

/** Why the stub would refuse a universal view, each `<pointer>: <what>`; none for one it keeps. */
export function universalProblems(view: UniversalView): string[] {
  const v = view as unknown as Record<string, unknown>;
  return [...idProblems(v, "a universal view"), ...shapeProblems(v)].sort();
}

function shapeProblems(v: Record<string, unknown>): string[] {
  const problems: string[] = [];
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
  return problems;
}

/** Why the stub would refuse a view in either language. */
export function anyViewProblems(view: AnyView): string[] {
  if (isPage(view)) return pageProblems(view);
  return isUniversal(view) ? universalProblems(view) : viewProblems(view as View);
}

/** The id a kept view is saved under. */
export const idOf = (view: AnyView): string => view.id ?? "";

/** view.list's line: an item view's version, a universal view's type, a page's sections. */
export function summaryOf(view: AnyView): ViewSummary {
  const described = view.description === undefined ? {} : { description: view.description };
  if (isPage(view))
    return {
      id: idOf(view),
      title: view.title ?? idOf(view),
      sections: view.sections.length,
      ...described,
      source: "file",
    };
  if (isUniversal(view))
    return {
      id: idOf(view),
      title: view.title ?? idOf(view),
      type: view.type,
      ...described,
      source: "file",
    };
  const item = view as View;
  return { id: item.id, version: item.version, title: item.title, ...described, source: "file" };
}
