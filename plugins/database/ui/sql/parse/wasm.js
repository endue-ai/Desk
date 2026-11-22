// PostgreSQL's own parser, libpg_query built to WebAssembly (ui/vendor, ADR 0283), behind three calls:
// a script in, its raw parse tree as libpg_query's JSON or the server's error out; a script in,
// the server's scanner's tokens out (the layout reads them, ADR 0292); and a routine's statement in,
// PL/pgSQL's own tree of its body or its grammar's message out (the problems read it, ADR 0343). No
// DOM and no fetch: the caller hands over the wasm, so the same module runs in the parse worker and
// in Node for the tests.
import PgQueryModule from "../../vendor/libpg-query.mjs";

/**
 * @typedef {{ version: number, stmts?: Array<{ stmt?: Record<string, any>, stmt_location?: number, stmt_len?: number }> }} RawTree
 * @typedef {{ message: string, cursor: number }} RawError `cursor` counts characters from 1; 0 is none
 * @typedef {{ tree: RawTree } | { error: RawError }} RawResult
 * @typedef {{ start: number, end: number, text: string, tokenName: string, keywordKind: number }} RawToken
 *   `start` and `end` are UTF-8 bytes; `keywordKind` is 0 for none, then unreserved, column name,
 *   type or function name and reserved (1 to 4), as the server's keyword list has them.
 * @typedef {{ tokens: RawToken[] } | { error: string }} RawScan
 * @typedef {{ funcs: Array<Record<string, any>> } | { error: string }} RawPlpgsql
 *   PL/pgSQL's own parse of the routines of a CREATE FUNCTION, CREATE PROCEDURE or DO statement
 *   (ADR 0343): each routine's `PLpgSQL_function` tree, or the grammar's message (no position).
 * @typedef {{ parse(text: string): RawResult, scan(text: string): RawScan,
 *   plpgsql(text: string): RawPlpgsql, broken(): boolean }} RawParser
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
  // A C string ends at NUL; lone surrogates go as U+FFFD, the bytes a PostgreSQL driver sends.
  const sendable = (/** @type {string} */ text) =>
    text.replace(/\0/gu, " ").replace(SURROGATE, (s) => (s.length === 2 ? s : "�"));

  return {
    broken: () => broken,
    scan(text) {
      if (broken) throw new Error("The SQL parser stopped; it starts again on the next parse.");
      const sent = sendable(text);
      if (sent.trim() === "") return { tokens: [] };
      const size = module.lengthBytesUTF8(sent) + 1;
      const input = module._malloc(size);
      if (!input) throw new Error("The SQL parser is out of memory.");
      let result = 0;
      try {
        module.stringToUTF8(sent, input, size);
        result = module._wasm_scan(input);
        if (!result) throw new Error("The SQL parser is out of memory.");
        const answer = module.UTF8ToString(result);
        // The scanner answers its tokens as JSON, or its message as plain text.
        if (!answer.startsWith("{")) return { error: answer };
        const { tokens = [] } = JSON.parse(answer);
        return { tokens };
      } catch (error) {
        if (error instanceof SyntaxError) throw error;
        broken = true;
        throw error;
      } finally {
        if (!broken) {
          if (result) module._wasm_free_string(result);
          module._free(input);
        }
      }
    },
    plpgsql(text) {
      if (broken) throw new Error("The SQL parser stopped; it starts again on the next parse.");
      const sent = sendable(text);
      const size = module.lengthBytesUTF8(sent) + 1;
      const input = module._malloc(size);
      if (!input) throw new Error("The SQL parser is out of memory.");
      let result = 0;
      try {
        module.stringToUTF8(sent, input, size);
        result = module._wasm_parse_plpgsql(input);
        if (!result) throw new Error("The SQL parser is out of memory.");
        const answer = module.UTF8ToString(result);
        // The routines' trees as JSON, or the grammar's message as plain text.
        if (!answer.startsWith("{")) return { error: answer };
        const { plpgsql_funcs: funcs = [] } = JSON.parse(answer);
        return { funcs };
      } catch (error) {
        if (error instanceof SyntaxError) throw error;
        broken = true;
        throw error;
      } finally {
        if (!broken) {
          if (result) module._wasm_free_string(result);
          module._free(input);
        }
      }
    },
    parse(text) {
      if (broken) throw new Error("The SQL parser stopped; it starts again on the next parse.");
      const sent = sendable(text);
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
