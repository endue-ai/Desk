const MAX_OPERATIONS = 256;

export function createSession(files, engine, paint) {
  let current;
  let details;

  const position = () => current.steps[current.cursor - 1]?.id ?? 0;

  function inspect() {
    if (!current) return { document: null };
    const { document, revision, path } = current;
    return { document, revision, path, ...details, dirty: current.saved !== position() };
  }

  async function load(path, restored) {
    const bytes = await files.read(path);
    const result = await engine.call(
      {
        type: "open",
        bytes,
        ...(restored && {
          expectedDigest: restored.digest,
          batches: restored.steps.map(({ operations }) => operations),
          undo: restored.steps.length - restored.cursor,
        }),
      },
      [bytes.buffer],
    );
    current = restored ?? {
      document: crypto.getRandomValues(new Uint32Array(4)).join("-"),
      revision: 0,
      path,
      digest: result.digest,
      steps: [],
      cursor: 0,
      next: 0,
      saved: 0,
    };
    details = result.details;
    paint(result);
    return inspect();
  }

  function checked(args) {
    if (!current) throw new Error("Open an image first.");
    if (args?.document !== current.document || args.revision !== current.revision) {
      throw new Error("The document changed. Inspect the current image before trying again.");
    }
  }

  async function recover() {
    if (!engine.connected()) await load(current.path, current);
  }

  return {
    inspect,
    snapshot: () => current,
    restore: (saved) => load(saved.path, saved),
    async open(path) {
      if (current?.path === path && path !== undefined) return inspect();
      if (inspect().dirty)
        throw new Error("Export or discard the current draft before opening another image.");
      const chosen = path ?? (await files.choose());
      return chosen ? load(chosen) : inspect();
    },
    async edit(type, args) {
      checked(args);
      const operations = args.operations;
      if (type === "apply") {
        const earlier = current.steps.slice(0, current.cursor);
        const count = earlier.reduce((total, step) => total + step.operations.length, 0);
        if (!Array.isArray(operations) || operations.length === 0 || operations.length > 16) {
          throw new Error("Apply one to sixteen operations in a batch.");
        }
        if (count + operations.length > MAX_OPERATIONS) {
          throw new Error("Export and reopen the image to continue after 256 operations.");
        }
      }
      await recover();
      const result = await engine.call(type === "apply" ? { type, operations } : { type });
      if (type === "apply") {
        current.steps.splice(current.cursor, current.steps.length - current.cursor, {
          id: ++current.next,
          operations,
        });
        current.cursor++;
      } else {
        current.cursor += type === "undo" ? -1 : 1;
      }
      current.revision++;
      details = result.details;
      paint(result);
      return inspect();
    },
    async export() {
      if (!current) throw new Error("Open an image first.");
      const path = await files.destination(current.path);
      if (!path) return { cancelled: true };
      await recover();
      const { data } = await engine.call({ type: "export" });
      await files.save(path, data);
      current.saved = position();
      return { path, bytes: data.length };
    },
    discard(target) {
      checked(target);
      current = undefined;
      details = undefined;
      engine.reset();
      paint();
    },
  };
}
