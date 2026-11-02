// File acquisition owns the read signal until its book closes. Opening is transactional: the
// previous view stays usable while metadata and the first page's dimensions are read.
import { openBook } from "./open.js";

const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);
const scopeOf = (path) => ({
  permission: "fs:read",
  paths: [`${path.slice(0, path.lastIndexOf("/"))}/**`],
});

export function createLoading(
  bridge,
  view,
  { byteSource, readBytes, pdfjs, startWorker = undefined },
) {
  let opening;
  const cancel = () => {
    opening?.abort();
    opening = undefined;
    view.progress?.(null);
  };
  return {
    cancel,
    async load(path, password) {
      cancel();
      const job = new AbortController();
      opening = job;
      const name = nameOf(path);
      const file = { path, scope: scopeOf(path) };
      let bytesRead = 0;
      const progress = (label, value = null, max = 1, detail = name) => {
        if (opening === job)
          view.progress?.({ label, value, max, detail, cancel: () => job.abort() });
      };
      const acquire = async () => {
        const raw = await byteSource({ bridge }, file, { signal: job.signal });
        // Probe inside the one-ask boundary: a URL can exist even when its fallback read is denied.
        await raw.read(0, Math.min(raw.size, 4096));
        return raw;
      };
      try {
        progress("Reading");
        view.status(`Opening ${name}…`);
        let raw;
        try {
          raw = await acquire();
        } catch (error) {
          job.signal.throwIfAborted();
          if (error?.code !== "permission_denied") throw error;
          const granted = await bridge
            .call("perm.request", {
              permission: file.scope,
              reason: `To open ${path} in Reader`,
            })
            .catch(() => ({ granted: false }));
          job.signal.throwIfAborted();
          if (!granted.granted) throw new Error(`Not allowed to read ${path}.`);
          raw = await acquire();
        }
        const decoding = new WeakMap();
        const source = {
          size: raw.size,
          cancel: (reason) => job.abort(reason),
          async read(offset, length, signal) {
            job.signal.throwIfAborted();
            signal?.throwIfAborted();
            let input = raw;
            if (signal) {
              if (!decoding.has(signal))
                decoding.set(
                  signal,
                  byteSource({ bridge }, file, {
                    signal: AbortSignal.any([job.signal, signal]),
                  }),
                );
              input = await decoding.get(signal);
            }
            const bytes = await input.read(offset, length);
            signal?.throwIfAborted();
            job.signal.throwIfAborted();
            bytesRead += bytes.length;
            progress("Reading", null, 1, `${bytesRead.toLocaleString("en-US")} bytes read`);
            return bytes;
          },
        };
        const book = await openBook(source, {
          name,
          path,
          password,
          pdfjs,
          startWorker,
          signal: job.signal,
          phase: (label) => progress(label),
          readAll: () =>
            readBytes({ bridge }, file, {
              signal: job.signal,
              onProgress: (done, total) =>
                progress(
                  "Reading",
                  done,
                  total,
                  `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes`,
                ),
            }),
        });
        job.signal.throwIfAborted();
        return { name, size: source.size, book, cancel: () => job.abort() };
      } catch (error) {
        const cancelled = job.signal.aborted && job.signal.reason?.name === "AbortError";
        job.abort();
        if (cancelled) throw new Error(`Opening ${name} was cancelled.`);
        if (error?.code === "permission_denied") throw new Error(`Not allowed to read ${path}.`);
        if (error?.code) throw new Error(`Could not read ${path}: ${error.code}.`);
        throw error;
      } finally {
        if (opening === job) {
          opening = undefined;
          view.progress?.(null);
        }
      }
    },
  };
}
