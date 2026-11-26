// The studio's commands for the palette and agents: reads answer with plain data (what is open,
// the requests of a collection); sends and runs share the Studio's request pipeline.
// The manifest reviews sends and runs, with a separate command for saved HTTP reads.
// Secrets never appear in what the commands return:
// secret headers, query pairs and JSON fields are hidden, and so is every secret's value. A
// request the agent writes itself (a url rather than a saved request's name) gets no secret
// variables filled in and no cookies from the jar: it could name any host.

import { responseData } from "./command-data.js";
import { registerEdits } from "./commands-edit.js";
import { registerReads } from "./commands-read.js";
import { clone, newRequest, pair } from "./model.js";
import { READ_METHODS, READ_ONLY_ERROR } from "./read-method.js";
import { requestsOf, startRun, summarize } from "./runner.js";
import { hideFailure, hideText, hideUrl, secretValues } from "./secret-names.js";
import { paramsFromUrl } from "./url.js";

/** @typedef {import("./studio.js").Studio} Studio */
/** @typedef {import("./app.js").Tab} Tab */
/** @typedef {(name: string, handler: (args: any) => unknown) => void} Register */
/**
 * @typedef {{
 *   S: Studio, saved(name: string, exact?: boolean): Tab, findTab(name?: string): Tab,
 *   collection(name?: string): import("./collection-fs.js").Collection,
 * }} CommandContext
 */

/** Every request of every open collection, with where it is. @param {Studio} S */
function everyRequest(S) {
  return S.collections.list.flatMap((/** @type {import("./collection-fs.js").Collection} */ coll) =>
    requestsOf(coll.children).map((i) => ({ coll, item: i })),
  );
}

/** @param {Studio} S @param {string} ref a request's name, "Folder / Name", or file path @param {boolean} [exact] */
function findRequest(S, ref, exact = false) {
  const want = ref.trim().toLowerCase();
  const all = everyRequest(S);
  const direct = all.find((x) => x.item.path === ref);
  if (direct) return direct;
  const byFolder = all.filter(
    (x) => `${x.item.folder ? `${x.item.folder} / ` : ""}${x.item.name}`.toLowerCase() === want,
  );
  const byShortName = all.filter((x) => x.item.name.toLowerCase() === want);
  const byName = byFolder.length ? byFolder : byShortName;
  if (exact && new Set([...byFolder, ...byShortName]).size > 1)
    throw new Error("Name the request's full collection path.");
  const hit = byName[0];
  if (!hit) throw new Error(`No open collection has a request called ${ref}.`);
  return hit;
}

/** @param {Studio} S @param {string} [name] */
function findCollection(S, name) {
  const list = S.collections.list;
  const coll = name
    ? list.find(
        (/** @type {any} */ c) => c.name.toLowerCase() === name.toLowerCase() || c.path === name,
      )
    : list[0];
  if (!coll)
    throw new Error(name ? `No open collection is called ${name}.` : "No collection is open.");
  return coll;
}

/** @param {any} ctx @param {Studio} S */
export function wireCommands(ctx, S) {
  /** @type {Register} */
  const on = (name, fn) =>
    ctx.commands?.on?.(`endue.api-studio.${name}`, (/** @type {any} */ args) => fn(args ?? {}));
  /** @type {CommandContext["saved"]} */
  const saved = (name, exact) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("Name a saved request.");
    const { coll, item } = findRequest(S, name, exact);
    return {
      id: `cmd-${Date.now()}`,
      req: clone(item.req),
      saved: null,
      ref: { collection: coll.path, path: item.path },
      reqTab: "params",
      resTab: "body",
    };
  };
  /** @type {CommandContext["findTab"]} */
  const findTab = (name) => {
    const tabs = S.app.state.tabs.filter((tab) => !tab.kind);
    const match =
      name === undefined
        ? tabs.filter((tab) => tab.id === S.app.state.active)
        : tabs.filter((tab) => tab.id === name || tab.ref?.path === name || tab.req.name === name);
    if (match.length !== 1) throw new Error("Name one open API request tab.");
    return /** @type {Tab} */ (match[0]);
  };
  const context = {
    S,
    saved,
    findTab,
    collection: (/** @type {string | undefined} */ name) => findCollection(S, name),
  };
  registerReads(on, context);
  registerEdits(on, context);

  on("open", (args) => {
    ctx.surface?.show?.();
    if (args.request) {
      const { coll, item } = findRequest(S, String(args.request));
      S.app.open(clone(item.req), { collection: coll.path, path: item.path });
      return { opened: item.name };
    }
    return { tabs: S.app.state.tabs.length };
  });
  on("new-request", (args) => {
    ctx.surface?.show?.();
    const req = newRequest({
      name: String(args.name ?? "Untitled request"),
      method: String(args.method ?? "GET").toUpperCase(),
      url: String(args.url ?? ""),
    });
    req.params = paramsFromUrl(req.url, []);
    S.app.open(req);
    return { opened: true };
  });
  on("state", () => ({
    collections: S.collections.list.map((/** @type {any} */ c) => ({
      name: c.name,
      path: c.path,
      requests: requestsOf(c.children).length,
      environments: c.envs.map((/** @type {any} */ e) => e.name),
      environment: S.envs.activeEnv(c)?.name ?? null,
    })),
    tabs: S.app.state.tabs.map((/** @type {any} */ t) => ({
      name: t.req.name,
      method: t.req.method,
      url: hideUrl(t.req.url),
      unsaved: S.app.dirty(t),
      status: t.response?.status ?? null,
    })),
    history: S.app.state.history.length,
  }));
  on("requests", (args) => {
    const coll = findCollection(S, args.collection);
    return {
      collection: coll.name,
      requests: requestsOf(coll.children).map((i) => ({
        folder: i.folder || null,
        name: i.name,
        method: i.method,
        url: hideUrl(i.req.url),
      })),
    };
  });
  on("send", async (args) => {
    /** @type {import("./app.js").Tab} */
    let tab;
    if (args.request) {
      tab = saved(String(args.request));
    } else if (args.url) {
      const req = newRequest({
        name: "Command request",
        method: String(args.method ?? "GET").toUpperCase(),
        url: String(args.url),
      });
      req.params = paramsFromUrl(req.url, []);
      for (const [k, v] of Object.entries(args.headers ?? {}))
        req.headers.push(pair({ key: k, value: String(v) }));
      if (args.body !== undefined) {
        req.body.mode = typeof args.body === "object" ? "json" : "text";
        if (req.body.mode === "json") req.body.json = JSON.stringify(args.body, null, 2);
        else req.body.text = String(args.body);
      }
      req.settings.cookies = false;
      tab = {
        id: `cmd-${Date.now()}`,
        req,
        saved: null,
        reqTab: "params",
        resTab: "body",
        agent: true,
      };
    } else throw new Error("Name a request, or give a url.");
    await S.send(tab);
    const answer = responseData(S, tab);
    if (!answer) throw new Error("The request did not run.");
    return answer;
  });
  on("send-read", async ({ request }) => {
    const tab = saved(request, true);
    if (!READ_METHODS.includes(tab.req.method)) throw new Error(READ_ONLY_ERROR);
    await S.send(tab, { readOnly: true });
    const answer = responseData(S, tab);
    if (!answer) throw new Error("The request did not run.");
    return answer;
  });
  on("run", async (args) => {
    const coll = findCollection(S, args.collection);
    const folder = args.folder
      ? requestsOf(coll.children).filter((i) =>
          i.folder.toLowerCase().startsWith(String(args.folder).toLowerCase()),
        )
      : requestsOf(coll.children);
    if (!folder.length) throw new Error("Nothing to run there.");
    const rows = await startRun(
      S,
      coll,
      folder,
      {
        iterations: Math.max(1, Math.min(100, Number(args.iterations) || 1)),
        delayMs: 0,
        stopOnFail: args.stopOnFail === true,
        data: [],
      },
      { onRow: () => {} },
    ).promise;
    const sum = summarize(rows);
    const values = secretValues(
      S.scopes({
        id: "run",
        req: newRequest(),
        saved: null,
        ref: { collection: coll.path, path: coll.path },
        reqTab: "",
        resTab: "",
      }),
    );
    /** A runner's line ("target: message") as an agent may read it. @param {string} line @param {string[]} sent */
    const safe = (line, sent) => {
      const all = [...values, ...sent];
      const target = /^([\w$.[\]'"-]+): /.exec(line)?.[1];
      return target ? hideFailure(target, line, all) : hideText(line, all);
    };
    return {
      ...sum,
      failures: rows
        .filter((r) => r.failed || r.error)
        .map((r) => ({
          request: r.item.name,
          iteration: r.iteration,
          status: r.status,
          problems: [...(r.error ? [r.error] : []), ...r.failures].map((line) =>
            safe(line, r.secrets ?? []),
          ),
        })),
    };
  });
  on("import-curl", (args) => {
    ctx.surface?.show?.();
    const tab = S.app.blank();
    if (!S.importCurl(tab, String(args.command ?? "")))
      throw new Error("That is not a curl command with a URL.");
    return { opened: tab.req.name };
  });
  on("ask", (args) => {
    ctx.surface?.show?.();
    if (args.question) void S.askAI(String(args.question));
    else S.app.layout({ rail: "assistant", side: true });
    return { asked: !!args.question };
  });
}
