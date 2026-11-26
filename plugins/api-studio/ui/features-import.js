// Bringing requests in and taking them out: an API description (OpenAPI or Swagger, JSON or YAML)
// or a HAR file, from a file, a URL or pasted text, written as a new collection on disk; and any
// request as code in a dozen languages, its secrets hidden unless asked.

import { sendContext } from "./actions.js";
import { codeGen } from "./codegen-view.js";
import {
  COLLECTION_FILE,
  ENV_DIR,
  ENV_EXT,
  envFile,
  FOLDER_FILE,
  freeName,
  groupFile,
  join,
  REQUEST_EXT,
  requestFile,
  text,
} from "./collection-fs.js";
import { h } from "./dom.js";
import { COLORS } from "./environments.js";
import { dialog } from "./menu.js";
import { newRequest, pair } from "./model.js";
import { fromHar, fromSpec, isSpec, readSpec } from "./openapi.js";
import { bodyText, prepare, readResponse } from "./send.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./openapi.js").Imported} Imported
 */

/** What a text holds: an API description, a HAR file, or nothing known. @param {string} raw @param {"openapi" | "swagger" | "har"} [kind] */
export function understand(raw, kind) {
  const doc = readSpec(raw);
  if (
    isSpec(doc) &&
    (!kind || (kind === "openapi" && doc.openapi) || (kind === "swagger" && doc.swagger))
  )
    return fromSpec(doc);
  if ((!kind || kind === "har") && Array.isArray(doc?.log?.entries)) return fromHar(doc);
  throw new Error("Not an OpenAPI or Swagger description, nor a HAR file.");
}

/** Write an import as a new collection folder in `parent`. @param {Studio} S @param {string} parent @param {Imported} imp */
export async function writeImport(S, parent, imp) {
  const files = S.collections.files;
  const root = await freeName(files, parent, imp.name, "", parent);
  await files.mkdir(root, root);
  const empty = { headers: [], scripts: { pre: "", post: "" } };
  await files.write(
    join(root, COLLECTION_FILE),
    text(
      groupFile({ name: imp.name, auth: imp.auth, vars: imp.vars, docs: imp.docs, ...empty }, true),
    ),
    root,
  );
  for (const [n, env] of imp.envs.entries()) {
    const path = await freeName(files, join(root, ENV_DIR), env.name, ENV_EXT, root);
    await files.write(
      path,
      text(
        envFile({
          path,
          name: env.name,
          color: COLORS[n % COLORS.length],
          vars: env.vars.map((v) => ({
            ...pair({ key: v.key, value: v.value }),
            ...(v.secret ? { secret: true } : {}),
          })),
        }),
      ),
      root,
    );
  }
  let seq = 0;
  for (const folder of imp.folders) {
    const dir = await freeName(files, root, folder.name, "", root);
    await files.write(
      join(dir, FOLDER_FILE),
      text(
        groupFile(
          {
            name: folder.name,
            auth: { type: "inherit" },
            vars: [],
            docs: folder.docs,
            seq: ++seq,
            ...empty,
          },
          false,
        ),
      ),
      root,
    );
    for (const req of folder.requests)
      await files.write(
        await freeName(files, dir, req.name, REQUEST_EXT, root),
        text(requestFile(req)),
        root,
      );
  }
  for (const req of imp.requests)
    await files.write(
      await freeName(files, root, req.name, REQUEST_EXT, root),
      text(requestFile({ ...req, seq: ++seq })),
      root,
    );
  return S.collections.open(root);
}

/** @param {Studio} S */
export function installImport(S) {
  const readPath = async (/** @type {string} */ path) => {
    if (typeof path !== "string" || !path.trim() || path.includes("\0"))
      throw new Error("Choose an API description file.");
    const scope = { permission: "fs:read", paths: [path] };
    const read = () => S.ctx.bridge.call("fs.read", { path, encoding: "utf8", scope });
    try {
      return String((await read())?.content ?? "");
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== "permission_denied") throw error;
      const answer = await S.ctx.bridge.call("perm.request", {
        permission: scope,
        reason: "Read the API description to import it.",
      });
      if (!answer?.granted) throw error;
      return String((await read())?.content ?? "");
    }
  };

  const keepImport = async (/** @type {Imported} */ imp) => {
    const count = imp.requests.length + imp.folders.reduce((n, f) => n + f.requests.length, 0);
    const picked = await S.ctx.bridge.call("dialog.open", {
      kind: "folders",
      intent: "destination",
      title: `Where to keep “${imp.name.slice(0, 140)}” (${count} requests)`,
    });
    const parent = picked?.cancelled ? undefined : picked?.paths?.[0];
    if (!parent) return { imported: 0, cancelled: true };
    const coll = await writeImport(S, parent, imp);
    if (coll) {
      // Secret values go to the desk's store; the environment files hold only their names.
      for (const made of imp.envs) {
        const env = coll.envs.find((e) => e.name === made.name);
        if (env && made.vars.some((v) => v.secret && v.value))
          await S.envs?.save(
            coll,
            env,
            env.vars.map((v) => ({
              ...v,
              value: made.vars.find((m) => m.key === v.key)?.value ?? v.value,
            })),
          );
      }
      S.collections.openGroup(coll, coll.path);
      if (coll.envs[0]) await S.envs?.use(coll, coll.envs[0].name);
    }
    S.app.layout({ rail: "collections", side: true });
    S.app.toast(`Imported ${count} requests into ${imp.name}`, "ok");
    return { imported: count };
  };

  S.importFile = async (
    /** @type {string} */ path,
    /** @type {"openapi" | "swagger" | "har" | undefined} */ kind,
  ) => keepImport(understand(await readPath(path), kind));

  /** Ask for a description and where to keep it, then write and open the collection. @param {"file" | "url" | "paste"} how */
  S.importSpec = async (how = "file") => {
    let raw = "";
    if (how === "file") {
      const chosen = await S.ctx.bridge
        .call("dialog.open", {
          title: "An OpenAPI, Swagger or HAR file",
          filters: [{ name: "API descriptions", extensions: ["json", "yaml", "yml", "har"] }],
        })
        .catch(() => undefined);
      const path = chosen?.cancelled ? undefined : chosen?.paths?.[0];
      if (!path) return;
      try {
        raw = await readPath(path);
      } catch (error) {
        S.app.toast(
          `Could not read it: ${String(/** @type {Error} */ (error)?.message ?? error)}`,
          "error",
        );
        return;
      }
    } else {
      const area = /** @type {HTMLTextAreaElement} */ (
        h("textarea.desk-field.as-paste", {
          spellcheck: "false",
          "aria-label": how === "url" ? "URL" : "Description",
          placeholder:
            how === "url"
              ? "https://petstore3.example.com/api/v3/openapi.json"
              : "openapi: 3.1.0\ninfo:\n  title: …",
        })
      );
      const answer = await dialog({
        title: how === "url" ? "Import from a URL" : "Paste an API description",
        className: "is-wide",
        body: [
          h(
            "p.as-dialog-text",
            null,
            how === "url"
              ? "The description is fetched with curl, as a request would be."
              : "OpenAPI 3, Swagger 2 (JSON or YAML) or a HAR file.",
          ),
          area,
        ],
        actions: [
          { label: "Cancel", value: () => undefined },
          { label: "Import", kind: "desk-btn-primary", value: () => area.value.trim() },
        ],
        focus: "textarea",
      });
      if (!answer) return;
      if (how === "url") {
        const { prep } = prepare(
          newRequest({
            url: answer,
            headers: [pair({ key: "Accept", value: "application/json, application/yaml, */*" })],
          }),
          { scopes: [] },
        );
        const res = readResponse(
          await S.engine.send(prep, { verbose: false }).promise,
          prep,
          "",
          [],
        );
        if (res.error || res.status >= 400)
          return S.app.toast(`Could not fetch it: ${res.error ?? res.status}`, "error");
        raw = bodyText(res);
      } else raw = answer;
    }
    /** @type {Imported} */
    let imp;
    try {
      imp = understand(raw);
    } catch (error) {
      S.app.toast(
        `Could not read it: ${String(/** @type {any} */ (error)?.message ?? error)}`,
        "error",
      );
      return;
    }
    try {
      await keepImport(imp);
    } catch (error) {
      S.app.toast(
        `Could not write the collection: ${String(/** @type {any} */ (error)?.message ?? error)}`,
        "error",
      );
    }
  };

  const imports = S.importMenu;
  S.importMenu = () => [
    ...(imports?.() ?? []),
    "-",
    { label: "Import an API description…", icon: "import", run: () => S.importSpec("file") },
    { label: "Import from a URL…", icon: "link", run: () => S.importSpec("url") },
    { label: "Paste an API description…", icon: "code", run: () => S.importSpec("paste") },
  ];
  const home = S.homeActions;
  S.homeActions = () => [
    ...home(),
    {
      icon: "upload",
      label: "Import OpenAPI",
      text: "A description, a HAR file or a URL",
      run: () => S.importSpec("file"),
    },
  ];

  /** Show a request as code. @param {import("./app.js").Tab} tab */
  S.showCode = async (tab) => {
    const { prep, missing } = prepare(tab.req, sendContext(S, tab));
    await dialog({
      title: "Code for this request",
      className: "is-code",
      body: codeGen(prep, { missing, onCopy: (t) => S.copy(t, "Code copied") }),
      actions: [{ label: "Done", kind: "desk-btn-primary", value: () => true }],
    });
  };
}
