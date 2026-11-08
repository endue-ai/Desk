import { describe, expect, it } from "vitest";
import { parseStats } from "../ui/parse-engine.js";
import { parseContainers, parseImages, parseNetworks, parseVolumes } from "../ui/parse-list.js";
import {
  chipOf,
  nextSort,
  parseQuery,
  uptimeOf,
  viewContainers,
  viewImages,
  viewNetworks,
  viewVolumes,
  withChip,
} from "../ui/query.js";
import { IMAGES, NETWORKS, PS, STATS, VOLUMES } from "./fixtures";
import { mount } from "./harness";

const containers = parseContainers(PS);
const names = (list: Array<{ name: string }>) => list.map((c) => c.name);
const byName = { key: "name", desc: false };

describe("search, filter and sort", () => {
  it("reads words and terms, negated ones too", () => {
    expect(parseQuery("  Web state:Running -is:stopped port:8080 -db ")).toEqual({
      words: ["web"],
      terms: [
        { key: "state", value: "running", not: false },
        { key: "is", value: "stopped", not: true },
        { key: "port", value: "8080", not: false },
        { key: "word", value: "db", not: true },
      ],
    });
  });

  it("searches containers by name, service, project, image, port and state", () => {
    const find = (text: string) => names(viewContainers(containers, text, byName));
    expect(find("")).toEqual(["scratch", "shop-db-1", "shop-web-1"]);
    expect(find("post")).toEqual(["shop-db-1"]);
    expect(find("is:running")).toEqual(["shop-db-1", "shop-web-1"]);
    expect(find("is:stopped")).toEqual(["scratch"]);
    expect(find("-is:stopped project:shop")).toEqual(["shop-db-1", "shop-web-1"]);
    expect(find("port:8080")).toEqual(["shop-web-1"]);
    expect(find("port:5432 health:healthy")).toEqual(["shop-db-1"]);
    expect(find("service:web")).toEqual(["shop-web-1"]);
    expect(find("image:alpine")).toEqual(["scratch"]);
    expect(find("shop -db")).toEqual(["shop-web-1"]);
    expect(find("nothing-like-it")).toEqual([]);
  });

  it("sorts containers by state, CPU, memory, uptime and image, either way", () => {
    const stats = parseStats(STATS);
    const sort = (key: string, desc = false) =>
      names(viewContainers(containers, "", { key, desc }, stats));
    expect(sort("name", true)).toEqual(["shop-web-1", "shop-db-1", "scratch"]);
    expect(sort("state")).toEqual(["shop-web-1", "shop-db-1", "scratch"]);
    expect(sort("cpu", true)).toEqual(["shop-db-1", "shop-web-1", "scratch"]);
    expect(sort("memory", true)).toEqual(["shop-db-1", "shop-web-1", "scratch"]);
    expect(sort("uptime", true)).toEqual(["shop-web-1", "shop-db-1", "scratch"]);
    expect(sort("image")).toEqual(["scratch", "shop-web-1", "shop-db-1"]);
    expect(uptimeOf("Up About an hour")).toBe(3600);
    expect(uptimeOf("Up 7 days (healthy)")).toBe(604_800);
    expect(uptimeOf("Up Less than a second")).toBe(0);
    expect(uptimeOf("Exited (0) 2 days ago")).toBe(-1);
  });

  it("filters and sorts images, volumes and networks", () => {
    const images = parseImages(IMAGES);
    const refs = (text: string, key = "name", desc = false) =>
      viewImages(images, text, { key, desc }).map((i) => i.ref);
    expect(refs("")).toEqual([
      "ghcr.io/acme/api@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "postgres:17",
      "0e4a9e06ad09",
    ]);
    expect(refs("", "size", true)).toEqual([
      "ghcr.io/acme/api@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "postgres:17",
      "0e4a9e06ad09",
    ]);
    expect(refs("is:dangling")).toEqual(["0e4a9e06ad09"]);
    expect(refs("is:used")).toEqual(["postgres:17"]);
    expect(refs("is:unused")).toEqual(["0e4a9e06ad09"]);
    expect(refs("tag:17")).toEqual(["postgres:17"]);
    expect(refs("", "created", true)[0]).toBe("0e4a9e06ad09");
    const volumes = parseVolumes(VOLUMES);
    expect(viewVolumes(volumes, "is:named", byName).map((v) => v.name)).toEqual(["shop_db-data"]);
    expect(viewVolumes(volumes, "", byName).map((v) => v.anonymous)).toEqual([false, true]);
    const networks = parseNetworks(NETWORKS);
    expect(viewNetworks(networks, "", byName).map((n) => n.name)).toEqual([
      "bridge",
      "backplane",
      "shop_default",
    ]);
    expect(viewNetworks(networks, "project:shop", byName).map((n) => n.name)).toEqual([
      "shop_default",
    ]);
  });

  it("puts a chip's term in place of the last, and cycles the sorts", () => {
    expect(withChip("web is:running", "is:stopped")).toBe("web is:stopped");
    expect(withChip("web is:running", "")).toBe("web");
    expect(chipOf("web is:Stopped")).toBe("is:stopped");
    expect(nextSort("containers", { key: "name", desc: true })).toEqual({
      key: "state",
      desc: false,
    });
    expect(nextSort("containers", { key: "image", desc: false }).key).toBe("name");
    expect(nextSort("volumes", { key: "name", desc: false }).key).toBe("name");
  });
});

describe("the list's query and sort", () => {
  it("is set by its command, kept across a reload, and given to the view with the list", async () => {
    const m = await mount();
    await m.host.invoke("endue.docker.filter", { view: "containers", query: "is:running" });
    expect(m.view.shown.at(-1)).toBe("containers");
    expect(m.view.prefsOf("containers")).toEqual({
      query: "is:running",
      sort: { key: "name", desc: false },
    });
    await m.host.invoke("endue.docker.sort", { view: "containers", key: "cpu", desc: true });
    expect(m.view.prefsOf("containers")?.sort).toEqual({ key: "cpu", desc: true });
    expect(m.host.state).toMatchObject({
      prefs: { containers: { query: "is:running", sort: { key: "cpu", desc: true } } },
    });
    await expect(
      m.host.invoke("endue.docker.sort", { view: "containers", key: "colour" }),
    ).rejects.toThrow(/name, state, cpu, memory, uptime or image/);
    const again = await mount({ state: m.host.state });
    expect(again.view.prefsOf("containers")?.query).toBe("is:running");
  });
});
