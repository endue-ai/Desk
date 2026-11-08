/**
 * What the browser stub checks before view.save keeps a view: the shape a view needs (an id, a
 * version, a title, and a layout of known containers and components; specs/view/v0) and the names
 * that must resolve in it, as `desk_bridge::view_problems` says. The core checks the whole schema.
 */
import type { ComponentType, ContainerType, View } from "./generated";

/** The view components the desk renders, in the spec's order. */
export const COMPONENTS = [
  "list",
  "table",
  "card",
  "detail",
  "calendar",
  "agenda",
  "kanban",
  "chart",
  "markdown",
  "stat",
] as const satisfies readonly ComponentType[];
const CONTAINERS: readonly string[] = ["grid", "split", "tabs", "stack"] satisfies ContainerType[];
const KNOWN: readonly string[] = COMPONENTS;

const VIEW_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

type Names = { requires: string[]; params: string[] };
type Node = Record<string, unknown>;

/** The params a template reads ({params.days}); `{{` and `}}` are literal braces. */
function paramsRead(text: string): string[] {
  const plain = text.replaceAll("{{", "").replaceAll("}}", "");
  return [...plain.matchAll(/\{params\.([^}|.]+)/g)].map((m) => m[1] ?? "");
}

/** Every string inside a JSON value, with its pointer. */
function strings(value: unknown, at: string): Array<[string, string]> {
  if (typeof value === "string") return [[at, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => strings(v, `${at}/${key}`));
}

/** The templates of one component: fields, text, binding where values and action args. */
function templates(node: Node, at: string): Array<[string, unknown]> {
  const list = (name: string) => (Array.isArray(node[name]) ? (node[name] as Node[]) : []);
  const binding = (node.binding ?? {}) as Node;
  const where = Array.isArray(binding.where) ? (binding.where as Node[]) : [];
  return [
    ...list("fields").map((f, i): [string, unknown] => [`${at}/fields/${i}/value`, f.value]),
    ...(node.text === undefined ? [] : [[`${at}/text`, node.text] as [string, unknown]]),
    ...where.flatMap((c, i) => strings(c.value, `${at}/binding/where/${i}/value`)),
    ...list("actions").flatMap((a, i) => strings(a.args, `${at}/actions/${i}/args`)),
  ];
}

function nodeProblems(node: unknown, at: string, names: Names): string[] {
  if (node === null || typeof node !== "object") return [`${at}: a layout node is an object`];
  const n = node as Node;
  const found = n.title === undefined ? [] : templateProblems(n.title, `${at}/title`, names);
  if (CONTAINERS.includes(String(n.type))) {
    const children = Array.isArray(n.children) ? n.children : [];
    if (children.length === 0) found.push(`${at}/children: a container needs children`);
    return found.concat(children.flatMap((c, i) => nodeProblems(c, `${at}/children/${i}`, names)));
  }
  if (!KNOWN.includes(String(n.type)))
    return [`${at}/type: ${String(n.type)} is neither a container nor a component`];
  if (n.type === "kanban" && n.groupBy === undefined)
    found.push(`${at}/groupBy: a kanban needs groupBy`);
  const sources = ((n.binding ?? {}) as Node).sources;
  for (const [i, source] of (Array.isArray(sources) ? sources : []).entries())
    if (String(source).startsWith("$") && !names.requires.includes(String(source).slice(1)))
      found.push(`${at}/binding/sources/${i}: ${source} is not one of the view's requires`);
  for (const [path, text] of templates(n, at)) found.push(...templateProblems(text, path, names));
  return found;
}

function templateProblems(text: unknown, at: string, { params }: Names): string[] {
  if (typeof text !== "string") return [`${at}: a template is a string`];
  return paramsRead(text)
    .filter((name) => !params.includes(name))
    .map((name) => `${at}: {params.${name}} reads a param the view does not declare`);
}

/** Why the stub would refuse a view, each `<pointer>: <what>`, sorted; none for a view it keeps. */
export function viewProblems(view: View): string[] {
  const v = view as unknown as Node;
  if (v === null || typeof v !== "object") return ["/: a view is an object"];
  const problems: string[] = [];
  if (typeof v.id !== "string" || !VIEW_ID.test(v.id)) problems.push("/id: not a view id");
  if (typeof v.version !== "string" || !VERSION.test(v.version))
    problems.push("/version: not a semantic version");
  const names = {
    requires: Object.keys((v.requires ?? {}) as Node),
    params: Object.keys((v.params ?? {}) as Node),
  };
  if (v.title === undefined) problems.push("/title: a view has a title");
  else problems.push(...templateProblems(v.title, "/title", names));
  if (v.layout === undefined) problems.push("/layout: a view has a layout");
  else problems.push(...nodeProblems(v.layout, "/layout", names));
  return problems.sort();
}
