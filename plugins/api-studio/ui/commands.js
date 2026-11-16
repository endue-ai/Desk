// The studio's commands for the palette and agents: reads answer with plain data (what is open,
// the requests of a collection); sending a request and running a collection go through the same
// send as the window (scripts, checks and tests included) and are marked irreversible in the
// manifest, so an agent's call waits for the person. Secrets never appear in what they return:
// secret headers, query pairs and JSON fields are hidden, and so is every secret's value. A
// request the agent writes itself (a url rather than a saved request's name) gets no secret
// variables filled in and no cookies from the jar: it could name any host.

import { clone, newRequest, pair } from "./model.js";
import { requestsOf, startRun, summarize } from "./runner.js";
import {
  HIDDEN,
  hideFailure,
  hideText,
  hideUrl,
  hideValues,
  isSecretName,
  secretValues,
} from "./secret-names.js";
import { bodyText } from "./send.js";
import { paramsFromUrl } from "./url.js";

/** @typedef {import("./studio.js").Studio} Studio */

/** Every request of every open collection, with where it is. @param {Studio} S */
function everyRequest(S) {
  return S.collections.list.flatMap((/** @type {import("./collection-fs.js").Collection} */ coll) =>
    requestsOf(coll.children).map((i) => ({ coll, item: i })),
  );
}

/** @param {Studio} S @param {string} ref a request's name, "Folder / Name", or file path */
function findRequest(S, ref) {
  const want = ref.trim().toLowerCase();
  const all = everyRequest(S);
  const hit =
    all.find((x) => x.item.path === ref) ??
    all.find(
      (x) => `${x.item.folder ? `${x.item.folder} / ` : ""}${x.item.name}`.toLowerCase() === want,
    ) ??
    all.find((x) => x.item.name.toLowerCase() === want);
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
  const on = (/** @type {string} */ name, /** @type {(args: any) => unknown} */ fn) =>
    ctx.commands?.on?.(`endue.api-studio.${name}`, (/** @type {any} */ args) => fn(args ?? {}));

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
      name: "Untitled request",
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
      const { coll, item } = findRequest(S, String(args.request));
      tab = {
        id: `cmd-${Date.now()}`,
        req: clone(item.req),
        saved: null,
        ref: { collection: coll.path, path: item.path },
        reqTab: "params",
        resTab: "body",
      };
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
    const res = tab.response;
    if (!res) throw new Error("The request did not run.");
    const r = tab.results;
    const scopes = S.scopes(tab);
    const values = [...secretValues(scopes), ...(tab.sentSecrets ?? [])];
    const held = tab.agent
      ? res.missing.filter((name) => scopes.some((s) => s.secret?.has(name)))
      : [];
    return {
      status: res.status,
      reason: res.reason,
      error: res.error ? hideValues(res.error, values) : null,
      ...(held.length
        ? {
            secretsNotFilled: held,
            note: "Secret variables are not filled in for a request given as a url. Send a saved request by name to use them.",
          }
        : {}),
      timeMs: Math.round(res.timings.total),
      size: res.size,
      headers: Object.fromEntries(
        res.headers.map(([k, v]) => [
          k,
          isSecretName(k)
            ? HIDDEN
            : /^location$/i.test(k)
              ? hideUrl(v, values)
              : hideValues(v, values),
        ]),
      ),
      body: hideText(bodyText(res).slice(0, 20_000), values),
      tests: r
        ? {
            passed: [...r.tests, ...r.asserts].filter((t) => t.ok).length,
            failed: [
              ...r.tests.filter((t) => !t.ok).map((t) => hideText(`${t.name}: ${t.error}`, values)),
              ...r.asserts
                .filter((a) => !a.ok)
                .map((a) => hideFailure(a.target, `${a.target}: ${a.message}`, values)),
              ...r.errors.map((e) => hideText(`${e.from}: ${e.text}`, values)),
            ],
          }
        : null,
    };
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
