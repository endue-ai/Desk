// The engine and its lists: connect (version and info), read each list with one `ls` and one
// `inspect` of everything it names, and say what is wrong when no engine answers. Each list loads
// on its own, so a slow one never holds the others; a load asked while one runs runs once after it.

import * as parse from "./parse.js";

/**
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {(args: string[], options?: import("./run.js").RunOptions) => Promise<Outcome>} Docker
 * @typedef {"containers" | "images" | "volumes" | "networks" | "projects" | "disk" | "contexts"} ListName
 */

export const LISTS = /** @type {ListName[]} */ ([
  "containers",
  "images",
  "volumes",
  "networks",
  "projects",
  "disk",
]);

/** docker inspect of many names at once, a few hundred per call so no command line grows too long. */
async function inspectAll(
  /** @type {Docker} */ docker,
  /** @type {string[]} */ head,
  /** @type {string[]} */ names,
) {
  /** @type {any[]} */
  const out = [];
  for (let at = 0; at < names.length; at += 200) {
    const chunk = names.slice(at, at + 200);
    // An object removed between ls and inspect makes inspect fail for it alone: keep the rest.
    const { stdout } = await docker([...head, "--", ...chunk], { ok: [1] });
    out.push(...parse.jsonArray(stdout));
  }
  return out;
}

const ids = (/** @type {string} */ text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** The readers of each list: docker in, models out. */
export const READERS = {
  /** @param {Docker} docker */
  async containers(docker) {
    const { stdout } = await docker(["container", "ls", "--all", "--quiet", "--no-trunc"]);
    const raw = await inspectAll(docker, ["container", "inspect"], ids(stdout));
    return raw.map(parse.container).sort((a, b) => b.created - a.created);
  },
  /** @param {Docker} docker */
  async images(docker) {
    const { stdout } = await docker(["image", "ls", "--quiet", "--no-trunc"]);
    const unique = [...new Set(ids(stdout))];
    const raw = await inspectAll(docker, ["image", "inspect"], unique);
    return raw.map(parse.image).sort((a, b) => b.created - a.created);
  },
  /** @param {Docker} docker */
  async volumes(docker) {
    const { stdout } = await docker(["volume", "ls", "--quiet"]);
    const raw = await inspectAll(docker, ["volume", "inspect"], ids(stdout));
    return raw.map(parse.volume).sort((a, b) => a.name.localeCompare(b.name));
  },
  /** @param {Docker} docker */
  async networks(docker) {
    const { stdout } = await docker(["network", "ls", "--quiet", "--no-trunc"]);
    const raw = await inspectAll(docker, ["network", "inspect"], ids(stdout));
    return raw.map(parse.network).sort((a, b) => a.name.localeCompare(b.name));
  },
  /** @param {Docker} docker */
  async projects(docker) {
    try {
      const { stdout } = await docker(["compose", "ls", "--all", "--format", "json"]);
      return parse.projects(stdout);
    } catch {
      // No Compose v2: projects still show from the containers' labels.
      return [];
    }
  },
  /** @param {Docker} docker */
  async disk(docker) {
    const { stdout } = await docker(["system", "df", "--format", "{{json .}}"], {
      timeoutMs: 60_000,
    });
    return parse.disk(stdout);
  },
  /** @param {Docker} docker */
  async contexts(docker) {
    const { stdout } = await docker(["context", "ls", "--format", "{{json .}}"]);
    return parse.contexts(stdout);
  },
};

/**
 * @param {{ docker: Docker, store: import("./store.js").Store }} deps
 */
export function createEngine({ docker, store }) {
  /** @type {Map<string, Promise<void>>} */
  const loading = new Map();
  /** @type {Set<string>} */
  const again = new Set();

  /** What is wrong, for the banner and the status bar. */
  const down = (/** @type {any} */ error) => {
    store.set({
      engine: {
        ...store.state.engine,
        status: "down",
        problem: String(error?.message ?? error),
        kind: error?.kind ?? "",
      },
    });
  };

  const connect = async () => {
    store.set({ engine: { ...store.state.engine, status: "connecting" } });
    let version;
    try {
      const { stdout } = await docker(["version", "--format", "{{json .}}"]);
      version = parse.jsonLines(stdout)[0];
    } catch (error) {
      down(error);
      void load("contexts").catch(() => {});
      return false;
    }
    let info;
    try {
      const { stdout } = await docker(["info", "--format", "{{json .}}"], { timeoutMs: 30_000 });
      info = parse.jsonLines(stdout)[0];
    } catch {
      // info is slow on some engines; the versions are enough to go on.
    }
    store.set({
      engine: { status: "up", problem: "", kind: "", info: parse.engine(version, info) },
    });
    return true;
  };

  /** Read one list into the store; a call while it reads makes it read once more after. */
  const load = (/** @type {ListName} */ name) => {
    const running = loading.get(name);
    if (running) {
      again.add(name);
      return running;
    }
    const job = (async () => {
      try {
        const value = await READERS[name](docker);
        const loaded = new Set(store.state.loaded).add(name);
        store.set({ [name]: value, loaded });
        if (name === "volumes") void sizes();
      } catch (error) {
        const kind = /** @type {any} */ (error)?.kind;
        if (kind === "daemon" || kind === "socket" || kind === "missing" || kind === "context")
          down(error);
        else throw error;
      } finally {
        loading.delete(name);
        if (again.delete(name)) void load(name).catch(() => {});
      }
    })();
    loading.set(name, job);
    return job;
  };

  /** Volume sizes come from a slower call; the list shows without them first. */
  const sizes = async () => {
    try {
      const { stdout } = await docker(["system", "df", "--verbose", "--format", "json"], {
        timeoutMs: 60_000,
      });
      store.set({ volumeSizes: parse.volumeSizes(stdout) });
    } catch {
      // An older CLI without JSON for the verbose view: sizes stay unknown.
    }
  };

  const loadAll = async () => {
    const up = await connect();
    if (!up) return false;
    await Promise.all(
      [...LISTS, "contexts"].map((name) => load(/** @type {ListName} */ (name)).catch(() => {})),
    );
    return true;
  };

  return { connect, load, loadAll, sizes };
}
