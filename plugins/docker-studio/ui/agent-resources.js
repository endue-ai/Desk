// Resource reads and writes over the same models and actions as the Studio window.
import { buildForm } from "./build.js";
import { pruneKinds, runPrune } from "./cleanup.js";
import { upArgs } from "./compose.js";
import { containerPath, lsArgs, parseLs } from "./files.js";
import { searchImages } from "./image-search.js";
import { historyArgs, parseHistory } from "./images.js";
import { sample } from "./parse-live.js";
import { contextName, imageRef, objectRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App */
/** @typedef {import("@endue-ai/plugin-sdk").Invocation} Invocation */
/** @typedef {(name: string, run: (args: any, invocation?: Invocation) => unknown) => void} Register */

const LIMIT = 500;

/** @param {App} app @param {Register} on @param {() => Promise<void>} ready @param {(ref: unknown) => import("./parse.js").Container} findContainer */
export function wireResources(app, on, ready, findContainer) {
  const state = () => app.store.state;
  /** @param {import("./engine.js").ListName} list */
  const load = async (list) => {
    await ready();
    await app.engine.load(list);
    await ready();
  };
  const findImage = (/** @type {string} */ ref) => {
    const exact = state().images.find(
      ({ id, refs, digests }) => id === ref || refs.includes(ref) || digests.includes(ref),
    );
    if (exact) return exact;
    const plain = ref.replace(/^sha256:/, "");
    const matches = state().images.filter(({ id }) => id.replace(/^sha256:/, "").startsWith(plain));
    if (matches.length === 1 && matches[0]) return matches[0];
    throw new Error(
      matches.length > 1 ? `Image ${ref} is ambiguous.` : `No image is called ${ref}.`,
    );
  };
  on("volumes", async () => {
    await load("volumes");
    return state()
      .volumes.slice(0, LIMIT)
      .map(({ name, driver, scope, project, anonymous, created }) => ({
        name,
        driver,
        scope,
        project,
        anonymous,
        created,
        size: state().volumeSizes.get(name) ?? null,
      }));
  });
  on("networks", async () => {
    await load("networks");
    return state()
      .networks.slice(0, LIMIT)
      .map(({ id, name, driver, scope, internal, subnet, gateway, members, builtin }) => ({
        id,
        name,
        driver,
        scope,
        internal,
        subnet,
        gateway,
        members: members.slice(0, LIMIT),
        builtin,
      }));
  });
  on("image", async ({ image }) => {
    await load("images");
    const ref = imageRef(image);
    const found = findImage(ref);
    const { stdout } = await app.docker(historyArgs(found.id));
    const layers = parseHistory(stdout)
      .slice(0, LIMIT)
      .map(({ id, created, size, empty }) => ({ id, created, size, empty }));
    const { id, refs, digests, size, created, os, arch, exposed } = found;
    return { id, refs, digests, size, created, os, arch, exposed, layers };
  });
  on("builds", () => {
    /** @param {import("./actions-build.js").BuildRecord} record */
    const data = ({ id, tag, started, ended, status, steps, image }) => ({
      id,
      tag,
      started,
      ended,
      status,
      steps: steps
        .slice(0, LIMIT)
        .map(({ stage, status, seconds }) => ({ stage, status, seconds })),
      image,
    });
    return {
      running: app.builds
        .active()
        .slice(0, 20)
        .map((/** @type {{ record: import("./actions-build.js").BuildRecord }} */ entry) =>
          data(entry.record),
        ),
      history: app.builds.history().slice(0, 20).map(data),
    };
  });
  on("contexts", async () => {
    await load("contexts");
    return {
      selected: state().context,
      contexts: state()
        .contexts.slice(0, LIMIT)
        .map(({ name, current }) => ({ name, current })),
    };
  });
  on("search", async ({ query }) => {
    await ready();
    return searchImages(app.docker, query);
  });
  on("files", async ({ container, path }) => {
    await ready();
    const target = findContainer(container);
    const at = containerPath(path);
    const { stdout } = await app.docker(lsArgs(target.id, at));
    return { container: target.name, path: at, entries: parseLs(stdout, at).slice(0, LIMIT) };
  });
  on("stats", async ({ container }) => {
    await ready();
    const target = container === undefined ? undefined : findContainer(container);
    const { stdout } = await app.docker(
      [
        "stats",
        "--no-stream",
        "--no-trunc",
        "--format",
        "{{json .}}",
        ...(target ? ["--", target.id] : []),
      ],
      { timeoutMs: 30_000 },
    );
    return stdout
      .split("\n")
      .flatMap((line) => {
        const result = sample(line);
        return result ? [result] : [];
      })
      .slice(0, LIMIT);
  });

  on("volume-create", async ({ name, driver }) => {
    await ready();
    return { done: await app.objects.createVolume(name, driver) };
  });
  on("volume-remove", async ({ volume }, invocation) => {
    await load("volumes");
    const name = objectRef(volume, "The volume");
    const found = state().volumes.find((item) => item.name === name);
    if (!found) throw new Error(`No volume is called ${name}.`);
    return { done: await app.objects.removeVolumes([found], invocation?.approved === true) };
  });
  on(
    "network-create",
    async ({
      name,
      driver = "bridge",
      subnet = "",
      gateway = "",
      internal = false,
      attachable = false,
    }) => {
      await ready();
      return {
        done: await app.objects.createNetwork({
          name,
          driver,
          subnet,
          gateway,
          internal,
          attachable,
        }),
      };
    },
  );
  on("network-connect", async ({ network, container }) => {
    await ready();
    return { done: await app.objects.connect("connect", network, findContainer(container).id) };
  });
  on("network-remove", async ({ network }, invocation) => {
    await load("networks");
    const ref = objectRef(network, "The network");
    const found = state().networks.find(({ id, name }) => id === ref || name === ref);
    if (!found) throw new Error(`No network is called ${ref}.`);
    return { done: await app.objects.removeNetworks([found], invocation?.approved === true) };
  });
  on("tag", async ({ image, target }) => {
    await load("images");
    return { done: await app.images.tag(findImage(imageRef(image)), imageRef(target)) };
  });
  on("remove-image", async ({ image }, invocation) => {
    await load("images");
    const ref = imageRef(image);
    const found = findImage(ref);
    return {
      done: await app.images.removeImages(
        [{ ...found, refs: [ref] }],
        invocation?.approved === true,
      ),
    };
  });
  on("push", async ({ image }) => {
    await ready();
    const ref = imageRef(image);
    return { pushed: (await app.images.transfer("push", ref, () => {})) ? ref : null };
  });
  on("use-context", async ({ name }) => {
    const context = contextName(name);
    await app.engine.load("contexts");
    if (!state().contexts.some((item) => item.name === context))
      throw new Error(`No Docker context is called ${context}.`);
    app.useContext(context);
    return { context };
  });
  on("compose-up", async ({ file, project = "" }) => {
    await ready();
    const argv = upArgs({
      file: typeof file === "string" ? file : "",
      project,
      build: false,
      pull: false,
    });
    await app.docker(argv, { cwd: file.slice(0, file.lastIndexOf("/")) || "/", timeoutMs: 0 });
    void app.engine.load("projects").catch(() => {});
    void app.engine.load("containers").catch(() => {});
    return { done: true, file, project: project || null };
  });
  on("prune", async ({ kinds }, invocation) => {
    const chosen = pruneKinds(kinds);
    await ready();
    if (!invocation?.approved) {
      const ok = await app.overlay.confirm({
        title: "Clean up Docker resources?",
        text: `Clean up ${chosen.join(", ")}. Removed data is gone for good.`,
        ok: "Clean up",
        danger: true,
      });
      if (!ok) return { done: false, results: [] };
    }
    const results = await runPrune(app, chosen);
    return { done: results.every(({ done }) => done), results };
  });
}

/** @param {App} app @param {{context: string, tag: string}} args */
export async function buildForCommand(app, { context, tag }) {
  if (typeof context !== "string" || typeof tag !== "string" || !tag.trim()) {
    throw new Error("Give the absolute build context and image tag.");
  }
  const { id, status, image } = await app.builds.start({
    ...buildForm(context),
    tag: imageRef(tag),
  });
  return { id, status, image };
}
