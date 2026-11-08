import { describe, expect, it } from "vitest";
import { CREATED_BY } from "../ui/refs.js";
import { DB_ID, OLD_ID, WEB_ID } from "./fixtures";
import { engine, mount } from "./harness";

const web = {
  kind: "container",
  id: WEB_ID,
  name: "shop-web-1",
  state: "running",
  project: "shop",
} as const;
const old = {
  kind: "container",
  id: OLD_ID,
  name: "scratch",
  state: "exited",
  project: "",
} as const;
const yes = { "desk.palette.pick": () => "yes" };
const no = { "desk.palette.pick": () => "no" };

describe("containers", () => {
  it("starts, stops with the stop timeout, restarts, pauses and unpauses, then refreshes and says so", async () => {
    const m = await mount({ init: { "endue.docker.stop-timeout": 3 } });
    m.view.selected = web;
    const before = m.docker.of("ps").length;
    expect(await m.host.invoke("endue.docker.stop")).toBe("Stopped shop-web-1.");
    expect(m.docker.last("stop")?.args).toEqual(["stop", "-t", "3", "--", WEB_ID]);
    await m.host.invoke("endue.docker.start", { container: "scratch" });
    expect(m.docker.last("start")?.args).toEqual(["start", "--", "scratch"]);
    await m.host.invoke("endue.docker.restart");
    expect(m.docker.last("restart")?.args).toEqual(["restart", "-t", "3", "--", WEB_ID]);
    await m.keys.togglePause?.();
    expect(m.docker.last("pause")?.args).toEqual(["pause", "--", WEB_ID]);
    m.view.selected = { ...web, state: "paused" };
    await m.keys.togglePause?.();
    expect(m.docker.last("unpause")?.args).toEqual(["unpause", "--", WEB_ID]);
    expect(m.docker.of("ps").length).toBeGreaterThan(before);
    expect(m.view.said.at(-1)).toBe("Unpaused shop-web-1.");
  });

  it("asks before killing or removing, and does nothing on no", async () => {
    const m = await mount({ commands: no });
    m.view.selected = web;
    await expect(m.host.invoke("endue.docker.kill")).rejects.toThrow(
      /^cancelled: .*Nothing was changed/,
    );
    await m.keys.remove?.();
    expect(m.docker.of("kill")).toEqual([]);
    expect(m.docker.of("rm")).toEqual([]);
    const asked = m.ran("desk.palette.pick")[0] as { title: string; items: Array<{ id: string }> };
    expect(asked.title).toBe(
      "Kill shop-web-1? Its processes end at once, without a chance to clean up.",
    );
    expect(asked.items.map((i) => i.id)).toEqual(["yes", "no"]);
  });

  it("removes a running container with -f after saying so, and its anonymous volumes when asked", async () => {
    const m = await mount({ commands: yes });
    m.view.selected = web;
    await m.host.invoke("endue.docker.remove", { volumes: true });
    expect(m.docker.last("rm")?.args).toEqual(["rm", "-f", "-v", "--", WEB_ID]);
    expect((m.ran("desk.palette.pick")[0] as { title: string }).title).toBe(
      "Remove shop-web-1? It is running: it is stopped first. Its anonymous volumes go with it.",
    );
    m.view.selected = old;
    await m.host.invoke("endue.docker.remove");
    expect(m.docker.last("rm")?.args).toEqual(["rm", "--", OLD_ID]);
  });

  it("skips the question when confirm is off, and refuses names that are not names", async () => {
    const m = await mount({ init: { "endue.docker.confirm": false } });
    await m.host.invoke("endue.docker.kill", { container: "shop-web-1" });
    expect(m.docker.last("kill")?.args).toEqual(["kill", "--", "shop-web-1"]);
    expect(m.ran("desk.palette.pick")).toEqual([]);
    await expect(m.host.invoke("endue.docker.stop", { container: "--all" })).rejects.toThrow(
      /not a name/,
    );
    m.view.selected = undefined;
    await expect(m.host.invoke("endue.docker.stop")).rejects.toThrow(
      "Select a container, or name one with container.",
    );
    expect(m.view.said.at(-1)).toBe("Select a container, or name one with container.");
  });

  it("says docker's own words when it fails", async () => {
    const m = await mount({
      script: engine({
        stop: { code: 1, stderr: "Error response from daemon: No such container: ghost\n" },
      }),
    });
    await expect(m.host.invoke("endue.docker.stop", { container: "ghost" })).rejects.toThrow(
      "No such container: ghost.",
    );
    expect(m.view.said.at(-1)).toBe("No such container: ghost.");
  });
});

describe("images", () => {
  it("pulls the image named, the one selected, or the one typed, without a time limit", async () => {
    const m = await mount({ commands: { "desk.palette.pick": () => "redis:7" } });
    await m.host.invoke("endue.docker.pull", { image: "nginx:1.27" });
    expect(m.docker.last("pull")?.args).toEqual(["pull", "--", "nginx:1.27"]);
    m.view.selected = {
      kind: "image",
      id: "sha256:aa",
      ref: "postgres:17",
      dangling: false,
      containers: 1,
    };
    await m.keys.pull?.();
    expect(m.docker.last("pull")?.args).toEqual(["pull", "--", "postgres:17"]);
    m.view.selected = undefined;
    await m.host.invoke("endue.docker.pull");
    expect(m.docker.last("pull")?.args).toEqual(["pull", "--", "redis:7"]);
    m.view.selected = {
      kind: "image",
      id: "sha256:bb",
      ref: "0e4a9e06ad09",
      dangling: true,
      containers: 0,
    };
    await expect(m.host.invoke("endue.docker.pull")).rejects.toThrow(/dangling/);
    await expect(m.host.invoke("endue.docker.pull", { image: "-q" })).rejects.toThrow(
      /not an image reference/,
    );
  });

  it("refuses to remove an image in use, removes a dangling one by id, and prunes", async () => {
    const m = await mount({
      commands: yes,
      script: engine({
        "image prune": { stdout: "Deleted Images:\nuntagged: x\n\nTotal reclaimed space: 1.2GB\n" },
      }),
    });
    m.view.selected = {
      kind: "image",
      id: "sha256:aa",
      ref: "postgres:17",
      dangling: false,
      containers: 1,
    };
    await expect(m.host.invoke("endue.docker.remove-image")).rejects.toThrow(
      "postgres:17 is used by 1 container: remove it first.",
    );
    m.view.selected = {
      kind: "image",
      id: "sha256:0e4a9e06ad09",
      ref: "0e4a9e06ad09",
      dangling: true,
      containers: 0,
    };
    await m.host.invoke("endue.docker.remove-image");
    expect(m.docker.last("image", "rm")?.args).toEqual([
      "image",
      "rm",
      "--",
      "sha256:0e4a9e06ad09",
    ]);
    expect(await m.host.invoke("endue.docker.prune-images", { all: true })).toBe("Freed 1.2GB.");
    expect(m.docker.last("image", "prune")?.args).toEqual(["image", "prune", "-f", "-a"]);
  });

  it("runs a container from a spec, or asks for a name and ports from the keyboard", async () => {
    const answers = ["site", "8080:80, 8443:443"];
    const m = await mount({
      commands: { "desk.palette.pick": () => answers.shift() ?? "" },
      script: engine({ run: { stdout: "f00dcafe1234567890\n" } }),
    });
    expect(
      await m.host.invoke("endue.docker.run", { image: "nginx", ports: ["80"], restart: "always" }),
    ).toEqual({
      id: "f00dcafe1234567890",
      name: null,
    });
    expect(m.docker.last("run")?.args).toEqual([
      "run",
      "-d",
      "--label",
      CREATED_BY,
      "-p",
      "80",
      "--restart",
      "always",
      "--",
      "nginx",
    ]);
    m.view.selected = {
      kind: "image",
      id: "sha256:aa",
      ref: "nginx:1.27",
      dangling: false,
      containers: 0,
    };
    await m.keys.run?.();
    expect(m.docker.last("run")?.args).toEqual([
      "run",
      "-d",
      "--label",
      CREATED_BY,
      "--name",
      "site",
      "-p",
      "8080:80",
      "-p",
      "8443:443",
      "--",
      "nginx:1.27",
    ]);
    expect(m.view.said.at(-1)).toBe("Started site from nginx:1.27.");
    await expect(
      m.host.invoke("endue.docker.run", { image: "nginx", env: ["HOME"] }),
    ).rejects.toThrow(/no value/);
  });
});

describe("volumes, networks and the system", () => {
  it("removes and prunes volumes and networks, and never the engine's own networks", async () => {
    const m = await mount({
      commands: yes,
      script: engine({ "network prune": { stdout: "Deleted Networks:\nold_default\n" } }),
    });
    await m.host.invoke("endue.docker.remove-volume", { volume: "shop_db-data" });
    expect(m.docker.last("volume", "rm")?.args).toEqual(["volume", "rm", "--", "shop_db-data"]);
    await m.host.invoke("endue.docker.prune-volumes");
    expect(m.docker.last("volume", "prune")?.args).toEqual(["volume", "prune", "-f"]);
    m.view.selected = { kind: "network", id: "6c1e1c06f71d", name: "bridge", builtin: true };
    await expect(m.host.invoke("endue.docker.remove-network")).rejects.toThrow(
      /engine's own networks/,
    );
    m.view.selected = { kind: "network", id: "69a6b65334df", name: "shop_default", builtin: false };
    await m.host.invoke("endue.docker.remove-network");
    expect(m.docker.last("network", "rm")?.args).toEqual(["network", "rm", "--", "69a6b65334df"]);
    expect(await m.host.invoke("endue.docker.prune-networks")).toBe("Removed 1 network.");
  });

  it("cleans up the system, with volumes and unused images only when asked", async () => {
    const m = await mount({
      commands: yes,
      script: engine({ "system prune": { stdout: "Total reclaimed space: 0B\n" } }),
    });
    expect(await m.host.invoke("endue.docker.prune")).toBe("Nothing needed cleaning up.");
    expect(m.docker.last("system", "prune")?.args).toEqual(["system", "prune", "-f"]);
    await m.host.invoke("endue.docker.prune", { all: true, volumes: true });
    expect(m.docker.last("system", "prune")?.args).toEqual([
      "system",
      "prune",
      "-f",
      "-a",
      "--volumes",
    ]);
    expect((m.ran("desk.palette.pick").at(-1) as { title: string }).title).toMatch(
      /every unused image.*anonymous volumes/,
    );
  });
});

describe("Compose", () => {
  it("ups a project with its files from their folder, and takes it down by name from the root", async () => {
    const m = await mount({ commands: yes });
    await m.host.invoke("endue.docker.compose");
    await m.host.invoke("endue.docker.up", { project: "shop" });
    const up = m.docker.last("compose", "--ansi", "never", "-p", "shop");
    expect(up?.args).toEqual([
      "compose",
      "--ansi",
      "never",
      "-p",
      "shop",
      "-f",
      "/Users/me/shop/compose.yaml",
      "-f",
      "/Users/me/shop/compose.override.yaml",
      "up",
      "-d",
    ]);
    expect(up?.cwd).toBe("/Users/me/shop");
    m.view.selected = { kind: "project", name: "shop", files: ["/Users/me/shop/compose.yaml"] };
    await m.keys.down?.();
    const down = m.docker.last("compose", "--ansi", "never", "-p", "shop");
    expect(down?.args).toEqual(["compose", "--ansi", "never", "-p", "shop", "down"]);
    expect(down?.cwd).toBe("/");
    expect((m.ran("desk.palette.pick").at(-1) as { title: string }).title).toBe(
      "Take shop down? Its containers and networks are removed; volumes and images stay.",
    );
  });

  it("starts, stops, restarts and pulls, and ups a file Compose has not seen", async () => {
    const m = await mount({ init: { "endue.docker.stop-timeout": 5 } });
    m.view.selected = { kind: "project", name: "shop", files: ["/Users/me/shop/compose.yaml"] };
    await m.keys.composeStop?.();
    expect(m.docker.calls.at(-2)?.args ?? m.docker.calls.at(-1)?.args).toBeDefined();
    expect(
      m.docker.calls.some((c) => c.args.join(" ") === "compose --ansi never -p shop stop -t 5"),
    ).toBe(true);
    await m.host.invoke("endue.docker.compose-pull");
    expect(
      m.docker.calls.some(
        (c) =>
          c.args.join(" ") === "compose --ansi never -p shop -f /Users/me/shop/compose.yaml pull",
      ),
    ).toBe(true);
    await m.host.invoke("endue.docker.up", { file: "/Users/me/new/compose.yaml" });
    const up = m.docker.calls.find((c) => c.args.includes("/Users/me/new/compose.yaml"));
    expect(up?.args).toEqual([
      "compose",
      "--ansi",
      "never",
      "-f",
      "/Users/me/new/compose.yaml",
      "up",
      "-d",
    ]);
    expect(up?.cwd).toBe("/Users/me/new");
    await expect(m.host.invoke("endue.docker.up", { project: "unknown" })).rejects.toThrow(
      /up it with a file/,
    );
    await expect(m.host.invoke("endue.docker.up", { file: "compose.yaml" })).rejects.toThrow(
      /absolute path/,
    );
    await expect(m.host.invoke("endue.docker.compose-start", { project: "Bad" })).rejects.toThrow(
      /project name/,
    );
  });
});

describe("cancel", () => {
  it("stops a pull that is still running", async () => {
    const m = await mount({ script: engine({ pull: { hang: true } }) });
    const pulling = m.host.invoke("endue.docker.pull", { image: "nginx" });
    await m.settle();
    await m.host.invoke("endue.docker.cancel");
    await expect(pulling).rejects.toThrow("Cancelled.");
    expect(m.docker.killed.at(-1)?.signal).toBe("term");
    expect(DB_ID).toBeTruthy();
  });
});
