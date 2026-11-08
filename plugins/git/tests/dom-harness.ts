// Mount the real DOM view against the same scripted Git and SDK test host as the controller tests.
import { readFileSync } from "node:fs";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createGit } from "../ui/git.js";
import { createView } from "../ui/view.js";
import { fakeGit, repository, type Script } from "./harness";

export async function mountDom(script: Script = repository(), logCount = 2) {
  document.documentElement.innerHTML = readFileSync("plugins/git/ui/index.html", "utf8");
  HTMLElement.prototype.scrollIntoView = () => {};
  const git = fakeGit(script);
  const host = createTestHost({
    pluginId: "endue.git",
    handlers: {
      "store.get": () => ({}),
      "store.set": () => ({}),
      "init.get": () => ({ profile: "default", settings: { "endue.git.log-count": logCount } }),
      ...git.handlers,
    },
    commands: {
      "desk.buffers.open": () => "endue.git:1",
      "desk.buffers.update": () => true,
    },
  });
  git.attach(host);
  let app: ReturnType<typeof createGit> | undefined;
  const view = createView(document, (action, ...args) => {
    const actions = app as unknown as Record<string, (...values: unknown[]) => unknown>;
    return actions[action]?.(...args);
  });
  await defineUiPlugin(
    {
      mount: (ctx) => {
        app = createGit(ctx, view);
      },
    },
    host.transport,
  );
  if (!app) throw new Error("the plugin did not mount");
  await app.ready;
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  return { host, git, view, settle };
}
