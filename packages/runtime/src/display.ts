/**
 * Display rules (desk.display, like display-buffer-alist): which area a new surface goes to, how
 * big it is, and whether it takes the focus. Rules are asked in layer order, later layers first; the
 * first that matches decides. Without a matching rule, the manifest's placement stands.
 */
import type { SurfacePlacement } from "@endue-ai/bridge";
import { globMatch, type PolicySet } from "./policy";

/** What a rule is asked about. */
export interface DisplayRequest {
  plugin: string;
  surface: string;
  /** The placement the manifest asks for. */
  placement: SurfacePlacement | undefined;
}

export interface DisplayDecision {
  area: SurfacePlacement;
  /** Grid cells, for center and floating surfaces. */
  columns: number;
  rows: number;
  /** The edge's width or height, for left, right and bottom surfaces. */
  pixels: number | undefined;
  reuse: boolean;
  focus: boolean;
  /** The plugin whose rule decided, or undefined when none matched. */
  rule: string | undefined;
}

export function decide(rules: PolicySet["display"], request: DisplayRequest): DisplayDecision {
  const rule = rules.find(({ match }) => {
    if (match.plugin !== undefined && !globMatch(match.plugin, request.plugin)) return false;
    if (match.surface !== undefined && match.surface !== request.surface) return false;
    if (match.placement !== undefined && match.placement !== request.placement) return false;
    return true;
  });
  return {
    area: rule?.area ?? request.placement ?? "center",
    columns: rule?.size?.columns ?? 1,
    rows: rule?.size?.rows ?? 1,
    pixels: rule?.size?.pixels,
    reuse: rule?.reuse ?? true,
    focus: rule?.focus ?? false,
    rule: rule?.owner,
  };
}
