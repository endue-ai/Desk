// The checks e2e.sandbox runs in its renderer. Each resolves to a short text a spec matches; the
// page puts it after "<name>: ok" or "<name>: failed". Imported by main.js and, for wasm, worker.js.

/** A module exporting add(a, b) = a + b: V8 compiles it to machine code (Liftoff) in this process. */
export const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

/** WebAssembly compiled and called: "2+3=5". */
export async function wasm() {
  const { instance } = await WebAssembly.instantiate(ADD_WASM);
  const sum = instance.exports.add(2, 3);
  if (sum !== 5) throw new Error(`add(2, 3) gave ${sum}`);
  return "2+3=5";
}

/** A file of the plugin's own, fetched from its desk-plugin origin. */
export async function scheme(base) {
  const response = await fetch(new URL("./data.txt", base));
  const text = (await response.text()).trim();
  if (!response.ok || text !== "sandbox fixture") throw new Error(`${response.status} ${text}`);
  return `${response.status} ${text}`;
}

const SHADER = `
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  data[id.x] = data[id.x] * 2u + 1u;
}`;

/** A WebGPU compute pass run on the GPU process and read back: "[3,5,7,9] <vendor>/<architecture>". */
export async function webgpu() {
  if (!navigator.gpu) throw new Error("no navigator.gpu");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("no adapter");
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });
  const usage = GPUBufferUsage;
  const storage = device.createBuffer({
    size: 16,
    usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST,
  });
  device.queue.writeBuffer(storage, 0, new Uint32Array([1, 2, 3, 4]));
  const readback = device.createBuffer({ size: 16, usage: usage.MAP_READ | usage.COPY_DST });
  const bindings = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storage } }],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindings);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, 16);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = JSON.stringify([...new Uint32Array(readback.getMappedRange())]);
  readback.unmap();
  device.destroy();
  if (out !== "[3,5,7,9]") throw new Error(`the pass gave ${out}`);
  return `${out} ${adapter.info.vendor}/${adapter.info.architecture}`;
}

/** Bytes as two-digit hex, space-separated. */
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
