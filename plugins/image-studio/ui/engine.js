// Copy responses out before the next request can grow or reuse the module's memory.
export async function createEngine(wasm) {
  const { instance } = await WebAssembly.instantiate(wasm);
  const engine = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function write(bytes) {
    const pointer = engine.input(bytes.length);
    if (!pointer) throw new Error("The image or request is too large.");
    new Uint8Array(engine.memory.buffer, pointer, bytes.length).set(bytes);
  }
  function read(length) {
    const result = JSON.parse(
      decoder.decode(new Uint8Array(engine.memory.buffer, engine.answer(), length)),
    );
    if (result.error) throw new Error(result.error);
    const size = result.preview?.bytes ?? result.bytes;
    if (size) result.data = new Uint8Array(engine.memory.buffer, engine.binary(), size).slice();
    return result;
  }
  return {
    digest(bytes) {
      write(bytes);
      return read(engine.digest()).digest;
    },
    load(width, height, pixels) {
      write(pixels);
      return read(engine.load(width, height));
    },
    call(request) {
      write(encoder.encode(JSON.stringify(request)));
      return read(engine.call());
    },
  };
}
