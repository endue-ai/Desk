// PostgreSQL's own parser, libpg_query built to WebAssembly (ui/vendor, ADR 0283), behind one call:
// a script in, its raw parse tree as libpg_query's JSON or the server's error out. No DOM and no
// fetch: the caller hands over the wasm, so the same module runs in the parse worker and in Node for
// the tests.
import PgQueryModule from "../../vendor/libpg-query.mjs";

/**
 * @typedef {{ version: number, stmts?: Array<{ stmt?: Record<string, any>, stmt_location?: number, stmt_len?: number }> }} RawTree
 * @typedef {{ message: string, cursor: number }} RawError `cursor` counts characters from 1; 0 is none
 * @typedef {{ tree: RawTree } | { error: RawError }} RawResult
 * @typedef {{ parse(text: string): RawResult, broken(): boolean }} RawParser
 */

// libpg_query's PgQueryParseResult and PgQueryError, 32-bit pointers.
const RESULT_ERROR = 8;
const ERROR_CURSOR = 16;
const SURROGATE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/gu;

/**
 * Compile (unless it is compiled already) and start the parser.
 * @param {ArrayBuffer | Uint8Array | WebAssembly.Module} wasm
 * @returns {Promise<RawParser>}
 */
export async function loadLibpgQuery(wasm) {
  const compiled =
    wasm instanceof WebAssembly.Module
      ? wasm
      : await WebAssembly.compile(/** @type {BufferSource} */ (wasm));
  /** @type {any} */
  const module = await PgQueryModule({
    instantiateWasm(
      /** @type {WebAssembly.Imports} */ imports,
      /** @type {(instance: WebAssembly.Instance) => void} */ receive,
    ) {
      WebAssembly.instantiate(compiled, imports).then(receive);
      return {};
    },
    print: () => {},
    printErr: () => {},
  });
  // A call that throws (a trap, the stack running out on deep nesting) skips libpg_query's clean-up
  // and leaves the instance unusable: it is then broken, and its owner loads a fresh one.
  let broken = false;

  return {
    broken: () => broken,
    parse(text) {
      if (broken) throw new Error("The SQL parser stopped; it starts again on the next parse.");
      // A C string ends at NUL; lone surrogates go as U+FFFD, the bytes a PostgreSQL driver sends.
      const sent = text.replace(/\0/gu, " ").replace(SURROGATE, (s) => (s.length === 2 ? s : "�"));
      const size = module.lengthBytesUTF8(sent) + 1;
      const input = module._malloc(size);
      if (!input) throw new Error("The SQL parser is out of memory.");
      let result = 0;
      try {
        module.stringToUTF8(sent, input, size);
        result = module._wasm_parse_query_raw(input);
        if (!result) throw new Error("The SQL parser is out of memory.");
        const failed = module.getValue(result + RESULT_ERROR, "i32");
        if (failed) {
          const message = module.UTF8ToString(module.getValue(failed, "i32"));
          return { error: { message, cursor: module.getValue(failed + ERROR_CURSOR, "i32") } };
        }
        const tree = module.getValue(result, "i32");
        if (!tree) throw new Error("The SQL parser is out of memory.");
        return { tree: JSON.parse(module.UTF8ToString(tree)) };
      } catch (error) {
        if (error instanceof SyntaxError) throw error;
        broken = true;
        if (error instanceof RangeError)
          throw new Error("The script nests too deeply for the SQL parser.", { cause: error });
        throw error;
      } finally {
        if (!broken) {
          if (result) module._wasm_free_parse_result(result);
          module._free(input);
        }
      }
    },
  };
}
