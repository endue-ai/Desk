// The few WASI calls FFmpeg's WebAssembly build makes (scripts/vendor-ffmpeg.sh links it as a
// standalone module, without Emscripten's JavaScript): clocks, random bytes, an empty environment,
// and stderr kept for the error a failure reports. There are no files, no sockets and no exit.

const ENOSYS = 52;
const ESPIPE = 70;
const MAX_LOG = 4096;

/**
 * The imports a module needs, from what it says it imports: the calls below where they exist,
 * otherwise a stub that answers ENOSYS, so a newer build fails a call rather than instantiation.
 * @param {WebAssembly.Module} module
 * @param {Record<string, Function>} wasi the calls of createWasi
 * @param {Record<string, Function>} env the module's other imports
 * @returns {WebAssembly.Imports}
 */
export function importsFor(module, wasi, env) {
  /** @type {Record<string, Record<string, Function>>} */
  const imports = {};
  for (const { module: from, name, kind } of WebAssembly.Module.imports(module)) {
    if (kind !== "function") continue;
    imports[from] ??= {};
    const table = imports[from];
    const own = from === "env" ? env[name] : wasi[name];
    table[name] = own ?? (() => (name.startsWith("__syscall") ? -ENOSYS : ENOSYS));
  }
  return imports;
}

/**
 * The WASI calls, on the module's memory once it is instantiated.
 * @param {() => WebAssembly.Memory} memory
 */
export function createWasi(memory) {
  const view = () => new DataView(memory().buffer);
  const zeros = (/** @type {number} */ ...pointers) => {
    for (const p of pointers) view().setUint32(p, 0, true);
    return 0;
  };
  let log = "";
  return {
    /** What FFmpeg wrote to stderr, for the error a failure reports; stdout is dropped. */
    log: () => log,
    fd_write(/** @type {number} */ fd, /** @type {number} */ iovs, n = 0, written = 0) {
      const v = view();
      let total = 0;
      for (let i = 0; i < n; i++) {
        const at = v.getUint32(iovs + i * 8, true);
        const length = v.getUint32(iovs + i * 8 + 4, true);
        total += length;
        if (fd === 2 && log.length < MAX_LOG)
          log += new TextDecoder().decode(new Uint8Array(memory().buffer, at, length));
      }
      v.setUint32(written, total, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => ESPIPE,
    fd_read: () => ENOSYS,
    fd_fdstat_get: () => ENOSYS,
    clock_time_get(/** @type {number} */ _id, /** @type {bigint} */ _precision, out = 0) {
      view().setBigUint64(out, BigInt(Math.round(Date.now() * 1e6)), true);
      return 0;
    },
    clock_res_get(/** @type {number} */ _id, out = 0) {
      view().setBigUint64(out, 1000n, true);
      return 0;
    },
    random_get(/** @type {number} */ at, length = 0) {
      for (let done = 0; done < length; done += 65536)
        crypto.getRandomValues(
          new Uint8Array(memory().buffer, at + done, Math.min(65536, length - done)),
        );
      return 0;
    },
    environ_sizes_get: zeros,
    environ_get: () => 0,
    args_sizes_get: zeros,
    args_get: () => 0,
    sched_yield: () => 0,
    proc_exit(/** @type {number} */ code) {
      throw new Error(`FFmpeg stopped with code ${code}.`);
    },
  };
}
