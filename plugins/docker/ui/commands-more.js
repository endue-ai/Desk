// The commands and keys of the redesigned surface: the overview, each list's query and sort, the
// detail pane's tabs, an image's history, a published port in the browser, a container's files and
// copies, and a build. No DOM: the view hands in what the person chose.

import { LINKS, portUrl } from "./ports.js";
import { queriedList } from "./prefs.js";
import { nextSort, SORTS } from "./query.js";
import { containerTarget, objectRef } from "./refs.js";

/**
 * @typedef {ReturnType<typeof import("./docker.js").createDocker>} App
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {Record<string, unknown>} Args
 * @typedef {(name: string, handler: (args: Args) => unknown) => unknown} Answer
 */

const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;

/**
 * @param {{ bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call"> }} ctx
 * @param {App} app
 * @param {Answer} answer
 * @returns {Record<string, (...args: unknown[]) => unknown>} The keys these add.
 */
export function wireMore({ bridge }, app, answer) {
  const { actions } = app;

  /** The list a query or sort is about: named, else the one on screen. */
  const listOf = (/** @type {Args} */ args) =>
    /** @type {ListName} */ (
      queriedList(args.view ?? (app.back() === "overview" ? "containers" : app.back()))
    );

  /** Set a list's query and show it. */
  const filter = async (/** @type {Args} */ args) => {
    const name = listOf(args);
    const prefs = app.setPrefs(name, app.prefs.query(name, args.query ?? ""));
    if (app.back() !== name) await app.showList(name);
    return { view: name, ...prefs };
  };

  /** Set a list's sort and show it. */
  const sort = async (/** @type {Args} */ args) => {
    const name = listOf(args);
    const prefs = app.setPrefs(name, app.prefs.sort(name, args.key, args.desc));
    if (app.back() !== name) await app.showList(name);
    return { view: name, ...prefs };
  };

  /** Open a container's published port in the browser: the one named, or the first, or one picked. */
  const openPort = async (/** @type {Args} */ args = {}) => {
    const { ref, name } = containerTarget(args, app.selection(), app.shown());
    const model = app.model("containers") ?? app.model("overview");
    const known = model?.containers?.find((/** @type {any} */ c) => c.id === ref || c.name === ref);
    const ports = /** @type {import("./parse-list.js").Port[]} */ (
      known?.ports ?? (await app.pane.loadDetail(ref)).ports
    );
    const open = ports.flatMap((p) => {
      const url = portUrl(p);
      return url ? [{ port: p, url }] : [];
    });
    if (open.length === 0) throw new Error(`${name} publishes no TCP port on this computer.`);
    let chosen = open[0];
    if (args.port !== undefined)
      chosen = open.find(
        (o) => o.port.host === String(args.port) || o.port.container === String(args.port),
      );
    else if (open.length > 1) {
      const picked = await app.pick(
        `Docker: open which port of ${name}?`,
        open.map((o) => ({
          id: o.url,
          label: o.url,
          detail: `${o.port.container}/${o.port.proto} in the container`,
        })),
      );
      if (picked === undefined || picked === "") return undefined;
      chosen = open.find((o) => o.url === picked);
    }
    if (!chosen) throw new Error(`${name} does not publish the port ${String(args.port)}.`);
    try {
      await bridge.call("shell.open", {
        target: chosen.url,
        scope: { ...LINKS, schemes: [...LINKS.schemes] },
      });
    } catch (error) {
      throw new Error(
        codeOf(error) === "permission_denied"
          ? "Not allowed to open links."
          : `Could not open ${chosen.url}.`,
      );
    }
    app.say(`Opened ${chosen.url}.`);
    return chosen.url;
  };

  /** An image's pane on its layers; the layers are the answer. */
  const history = (/** @type {Args} */ args = {}, tab = "history") =>
    app.pane.image(args, app.selection(), tab).then((layers) => {
      app.show("inspect");
      return layers;
    });

  /** A folder of a container in the Files tab; its entries are the answer. */
  const files = async (/** @type {Args} */ args = {}) => {
    const shown = app.pane.containerId();
    const wanted = args.container === undefined ? shown : objectRef(args.container);
    if (!wanted) throw new Error("Select a container, or name one with container.");
    const model = app.pane.model();
    const same = shown !== undefined && (shown === wanted || model?.title === wanted);
    if (!same) await app.inspect({ container: wanted }, "files");
    else app.pane.tab("files");
    const entries = await app.pane.listFiles(args.path ?? app.pane.model()?.files?.path ?? "/");
    app.show("inspect");
    return entries;
  };

  answer("endue.docker.overview", () => app.showList("overview"));
  answer("endue.docker.filter", filter);
  answer("endue.docker.sort", sort);
  answer("endue.docker.open-port", openPort);
  answer("endue.docker.history", (args) => history(args));
  answer("endue.docker.build", actions.build);
  answer("endue.docker.files", files);
  answer("endue.docker.copy-out", actions.copyOut);
  answer("endue.docker.copy-in", actions.copyIn);

  const g = app.guard;
  return {
    openPort: g(() => openPort()),
    /** A port link in a row or the Ports tab: the container and the host port it names. */
    openPortOf: g((/** @type {unknown} */ container, /** @type {unknown} */ port) =>
      openPort({ container: String(container), port: String(port) }),
    ),
    openImage: g(() => history({}, "info")),
    history: g(() => history({})),
    build: g(() => actions.build()),
    paneTab: g((/** @type {unknown} */ tab) => app.paneTab(String(tab))),
    /** The view's search field and chips. */
    query: g((/** @type {unknown} */ text) => {
      const name = listOf({});
      app.setPrefs(name, app.prefs.query(name, String(text ?? "")));
    }),
    /** The view's sort picker: a key and a direction. */
    sort: g((/** @type {unknown} */ key, /** @type {unknown} */ desc) => {
      const name = listOf({});
      app.setPrefs(name, app.prefs.sort(name, key, desc));
    }),
    nextSort: g(() => {
      const name = listOf({});
      const next = nextSort(name, app.prefs.get(name).sort);
      app.setPrefs(name, app.prefs.sort(name, next.key, next.desc));
      app.say(`Sorted by ${next.key}.`);
    }),
    reverseSort: g(() => {
      const name = listOf({});
      const { key, desc } = app.prefs.get(name).sort;
      app.setPrefs(name, app.prefs.sort(name, SORTS[name]?.includes(key) ? key : "name", !desc));
    }),
    /** The overview's lines: a list, filtered. */
    goto: g(async (/** @type {unknown} */ list, /** @type {unknown} */ query) => {
      const name = /** @type {ListName} */ (String(list));
      if (typeof query === "string" && SORTS[name])
        app.setPrefs(name, app.prefs.query(name, query));
      await app.showList(name);
    }),
    /** The Files tab: open a folder, or copy an entry out. */
    browse: g((/** @type {unknown} */ path) => files({ path })),
    copyOut: g((/** @type {unknown} */ path) => actions.copyOut({ path })),
    copyIn: g(() => actions.copyIn()),
    setFilter: (/** @type {unknown} */ text) => app.setFilter(String(text ?? "")),
    focused: (/** @type {unknown} */ where) => app.focused(where === "pane" ? "pane" : "list"),
    closePane: g(() => app.closePane()),
  };
}
