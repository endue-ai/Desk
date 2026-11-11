// Mounts the memory inspector on the SDK's test host over the fixture memory (fixtures.ts). The view
// records what it was asked to show; every confirmation is answered as the test says. The SDK is
// imported by its workspace path.
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Question } from "../ui/ask.js";
import { createMemory, type Shown } from "../ui/controller.js";
import { fixture, memoryHandlers } from "./fixtures";

export { type Entry, fixture } from "./fixtures";

export interface Mounted {
  host: TestHost;
  shown: Shown[];
  statuses: string[];
  asked: Question[];
  app: ReturnType<typeof createMemory>;
  last(): Shown;
  methods(): string[];
}

/** The inspector on the test host; `answer` is the person's answer to every confirmation. */
export async function mount(
  entries = fixture(),
  answer = true,
  refuse: Parameters<typeof createTestHost>[0]["refuse"] = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.memory",
    handlers: memoryHandlers(entries),
    refuse,
  });
  const shown: Shown[] = [];
  const statuses: string[] = [];
  const asked: Question[] = [];
  let app: ReturnType<typeof createMemory> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        const view = { show: (s: Shown) => shown.push(s), status: (t: string) => statuses.push(t) };
        app = createMemory(ctx, view, async (question) => {
          asked.push(question);
          return answer;
        });
        await app.ready;
      },
    },
    host.transport,
  );
  await host.settle();
  if (!app) throw new Error("the inspector did not mount");
  return {
    host,
    shown,
    statuses,
    asked,
    app,
    last: () => {
      const latest = shown.at(-1);
      if (!latest) throw new Error("nothing shown yet");
      return latest;
    },
    methods: () => host.calls.map((call) => call.method).filter((m) => m.startsWith("memory.")),
  };
}
