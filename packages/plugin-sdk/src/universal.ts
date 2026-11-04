// ctx.universal: universal views in a plugin's own surface (ADR 0084). `load` reads a source,
// `open` draws a view with `<desk-universal-view>` (from @endue-ai/ui, which the page loads) and keeps
// it current: an items source live over data.subscribe, the others again every `refresh` seconds.
// Its actions are commands: Enter on an entry runs the first, a board's move runs `move`, the
// composer runs `send`, each with its args filled from the entry.
import type {
  BridgeCallError,
  UniversalData,
  UniversalEntry,
  UniversalSource,
  UniversalView,
  ViewAction,
} from "@endue-ai/bridge";
import { loadUniversal, parseUniversal, type UniversalHost } from "./universal-load";

/** The element `open` draws in, as far as the SDK uses it (`DeskUniversalView` of @endue-ai/ui). */
export interface UniversalViewElement extends HTMLElement {
  view: Omit<UniversalView, "source"> | null;
  data: UniversalData | null;
  draft: string;
}

export interface UniversalOpenOptions {
  /** Before the element is added: set attributes (time-zone, density) or listen to its events. */
  setup?(element: UniversalViewElement): void;
  /** A load or a command failed; the view already says so where it can. */
  onError?(error: unknown): void;
}

/** An open universal view. */
export interface UniversalHandle {
  readonly element: UniversalViewElement;
  /** The document drawn now, after the last load and the moves since. */
  readonly data: UniversalData | null;
  /** Load the source again now. */
  reload(): Promise<void>;
  /** Stop reloading and listening, and take the element out. */
  close(): void;
}

/** Universal views for this plugin (ctx.universal). */
export interface PluginUniversal {
  /** Parse universal data from YAML or JSON text; a bare list is its entries. */
  parse(text: string): UniversalData;
  /** The document a source answers, under the plugin's own grants. */
  load(source: UniversalSource): Promise<UniversalData>;
  /** Draw `view` into `host`, load its source and keep it current. */
  open(host: Element, view: UniversalView, options?: UniversalOpenOptions): UniversalHandle;
}

const PLACEHOLDER = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\}/g;
const ALONE = /^\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)*)\}$/;

function at(scope: Record<string, unknown>, path: string): unknown {
  let value: unknown = scope;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * An action's args with every string a template over `scope` (the entry, plus `move` or `send`):
 * `{path}` is the value there, `{{` and `}}` are braces, and a string that is one placeholder keeps
 * the value's type.
 */
export function fillArgs(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const alone = ALONE.exec(value);
    if (alone) return at(scope, alone[1] ?? "") ?? "";
    return value.replace(PLACEHOLDER, (match, path: string | undefined) => {
      if (!path) return match === "{{" ? "{" : "}";
      const found = at(scope, path);
      return found === undefined || found === null
        ? ""
        : typeof found === "object"
          ? JSON.stringify(found)
          : String(found);
    });
  }
  if (Array.isArray(value)) return value.map((each) => fillArgs(each, scope));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillArgs(v, scope)]));
  return value;
}

const refused = (error: unknown) =>
  (error as Partial<BridgeCallError> | null)?.code === "permission_denied";

export function universalFor(host: UniversalHost): PluginUniversal {
  const run = (action: ViewAction, scope: Record<string, unknown>) => {
    const args = fillArgs(action.args ?? {}, scope);
    const object = args !== null && typeof args === "object" && !Array.isArray(args);
    return host.run(action.command, object ? (args as Record<string, unknown>) : { value: args });
  };
  const universal: PluginUniversal = {
    parse: parseUniversal,
    load: (source) => loadUniversal(host, source),
    open: (target, view, options = {}) => {
      const element = document.createElement("desk-universal-view") as UniversalViewElement;
      const { source, ...shown } = view;
      element.view = shown;
      element.setAttribute("state", "loading");
      let data: UniversalData | null = null;
      let open = true;
      let timer: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      const fail = (error: unknown) => {
        options.onError?.(error);
      };
      // Only the latest load draws: one that answers after a newer one began is dropped.
      let loads = 0;
      const reload = async () => {
        const mine = ++loads;
        try {
          const loaded = await universal.load(source);
          if (!open || mine !== loads) return;
          data = loaded;
          element.data = loaded;
          element.setAttribute("state", "ready");
          element.removeAttribute("message");
        } catch (error) {
          if (!open || mine !== loads) return;
          element.setAttribute("state", refused(error) ? "denied" : "error");
          if (!refused(error) && error instanceof Error)
            element.setAttribute("message", error.message);
          fail(error);
        }
      };
      element.addEventListener("desk-select", (event) => {
        const { entry } = (event as CustomEvent<{ entry: UniversalEntry }>).detail;
        const first = view.actions?.[0];
        if (first) run(first, { ...entry }).catch(fail);
      });
      element.addEventListener("desk-move", (event) => {
        const { entry, from, to } = (
          event as CustomEvent<{ entry: UniversalEntry; from: string; to: string }>
        ).detail;
        const before = element.data;
        queueMicrotask(() => {
          data = element.data;
        });
        if (!view.move) return;
        run(view.move, { ...entry, move: { from, to } }).catch((error) => {
          if (open && before) {
            element.data = before;
            data = before;
          }
          fail(error);
        });
      });
      element.addEventListener("desk-send", (event) => {
        const { text } = (event as CustomEvent<{ text: string }>).detail;
        if (!view.send) return;
        run(view.send, { send: { text } })
          .then(() => (open ? reload() : undefined))
          .catch((error) => {
            if (open && !element.draft) element.draft = text;
            fail(error);
          });
      });
      options.setup?.(element);
      target.append(element);
      void reload();
      if ("items" in source) {
        host
          .subscribe?.(source.items, () => void reload())
          .then((off) => {
            if (open) unsubscribe = off;
            else off();
          })
          .catch(fail);
      } else if (view.refresh && !("data" in source)) {
        timer = setInterval(() => void reload(), view.refresh * 1000);
      }
      return {
        element,
        get data() {
          return data;
        },
        reload,
        close: () => {
          open = false;
          if (timer !== undefined) clearInterval(timer);
          unsubscribe?.();
          element.remove();
        },
      };
    },
  };
  return universal;
}
