import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import bridgeSchema from "../../../specs/bridge/v0/bridge.schema.json";
import fsSchema from "../../../specs/bridge/v0/fs.schema.json";
import permissionSchema from "../../../specs/plugin/v0/permission.schema.json";
import { createLibrary, MODELS_DIR } from "../ui/library.js";
import { createStore, HOME, INDEX } from "../ui/store.js";
import { createThread, entryOf } from "../ui/threads.js";
import { nodeBridge } from "./node-bridge.js";

const ajv = new Ajv2020({ validateFormats: false });
ajv.addSchema([bridgeSchema, fsSchema, permissionSchema]);
const requests = new Map(
  ["Read", "Write", "List", "Trash"].map((kind) => {
    const validate = ajv.getSchema(`${fsSchema.$id}#/$defs/Fs${kind}Request`);
    if (!validate) throw new Error(`Missing fs.${kind} request schema`);
    const method: string = `fs.${kind.toLowerCase()}`;
    return [method, validate] as const;
  }),
);

it("reopens the thread index and uses the plugin's storage scope for every file operation", async () => {
  const disk = nodeBridge();
  const store = createStore({
    ...disk,
    async call(method, params) {
      const validate = requests.get(method);
      if (!validate) throw new Error(`Unexpected method ${method}`);
      expect(validate({ id: 1, method, params }), ajv.errorsText(validate.errors)).toBe(true);
      expect(params).toMatchObject({
        scope: { permission: method === "fs.read" ? "fs:read" : "fs:write", paths: [`${HOME}/**`] },
      });
      return disk.call(method, params);
    },
  });
  try {
    expect(await store.thread("missing")).toBeUndefined();
    expect(await store.index()).toEqual([]);
    expect(disk.calls.at(-1)).toMatchObject({ method: "fs.read", params: { path: INDEX } });
    const thread = createThread({ model: "test-model", now: 1000 });
    await store.saveThread(thread, { now: true });
    store.saveIndex([entryOf(thread)]);
    await store.flush();
    expect(await store.thread(thread.id)).toEqual(thread);
    expect(await store.index()).toEqual([entryOf(thread)]);
    await store.removeThread(thread.id);
    expect(await store.thread(thread.id)).toBeUndefined();
  } finally {
    disk.close();
  }
});

it("propagates a refused read, write and removal", async () => {
  const denied = Object.assign(new Error("Access refused"), { code: "permission_denied" });
  const store = createStore({ onEvent: () => () => {}, call: async () => Promise.reject(denied) });
  const thread = createThread();
  await expect(store.thread(thread.id)).rejects.toBe(denied);
  await expect(store.saveThread(thread, { now: true })).rejects.toBe(denied);
  await expect(store.removeThread(thread.id)).rejects.toBe(denied);
});

it("scans the initial library and an added folder using only the path of each operation", async () => {
  const disk = nodeBridge();
  const added = "~/Models";
  const file = `${added}/demo.gguf`;
  const library = createLibrary({
    ...createStore(disk),
    bridge: {
      ...disk,
      async call(method, params) {
        const validate = requests.get(method);
        if (!validate) throw new Error(`Unexpected method ${method}`);
        expect(validate({ id: 1, method, params }), ajv.errorsText(validate.errors)).toBe(true);
        const { path } = params as { path: string };
        expect(params).toMatchObject({
          scope: { permission: method === "fs.trash" ? "fs:write" : "fs:read", paths: [path] },
        });
        return disk.call(method, params);
      },
    },
  });
  try {
    await disk.call("fs.write", { path: file, content: "GGUF", createDirs: true });
    const models = await library.scan([MODELS_DIR, added]);
    expect(disk.calls).toContainEqual({
      method: "fs.list",
      params: { path: MODELS_DIR, scope: { permission: "fs:read", paths: [MODELS_DIR] } },
    });
    expect(models.map((m) => m.path)).toEqual([file]);
    expect(disk.calls.some((call) => call.method === "fs.read" && call.params.path === file)).toBe(
      true,
    );
    const [model] = models;
    if (!model) throw new Error("The added model is missing");
    await library.remove(model);
    expect(await library.scan([added])).toEqual([]);
  } finally {
    disk.close();
  }
});
