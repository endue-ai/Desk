// The kept computers (ui/computers.js): addresses as people type them, the checks, the list kept in
// the store without passwords, and one entry per address.
import { describe, expect, it } from "vitest";
import {
  addressOf,
  loadComputers,
  normalize,
  parseAddress,
  remove,
  saveComputers,
  upsert,
} from "../ui/computers.js";
import { fakeBridge } from "./harness";

const id = () => "m-fixed";

describe("computers", () => {
  it("reads an address as Finder's Connect to Server takes it", () => {
    expect(parseAddress("studio.local")).toEqual({ host: "studio.local" });
    expect(parseAddress(" Studio.Local:5901 ")).toEqual({ host: "studio.local", port: 5901 });
    expect(parseAddress("vnc://ada@192.0.2.10/")).toEqual({ host: "192.0.2.10", username: "ada" });
    for (const bad of [
      "",
      "studio local",
      "http://studio.local:80/x",
      "-studio",
      "studio.local:0",
    ]) {
      expect(() => parseAddress(bad), bad).toThrow();
    }
  });

  it("normalizes a form's entry: port 5900 by default, the host as the name, no empty user", () => {
    expect(normalize({ host: "studio.local" }, id)).toEqual({
      id: "m-fixed",
      name: "studio.local",
      host: "studio.local",
      port: 5900,
    });
    expect(
      normalize({ host: "vnc://ada@studio.local:5901", name: " Studio ", port: "" }, id),
    ).toEqual({
      id: "m-fixed",
      name: "Studio",
      host: "studio.local",
      port: 5901,
      username: "ada",
    });
    expect(normalize({ host: "studio.local", port: 5902, username: "grace" }, id)).toMatchObject({
      port: 5902,
      username: "grace",
    });
    expect(() => normalize({ host: "studio.local", port: "70000" }, id)).toThrow("not a port");
    expect(addressOf({ id: "a", name: "a", host: "studio.local", port: 5900 })).toBe(
      "studio.local",
    );
    expect(addressOf({ id: "a", name: "a", host: "studio.local", port: 5901 })).toBe(
      "studio.local:5901",
    );
  });

  it("keeps one entry per address, replacing it in place", () => {
    const a = normalize({ host: "studio.local", name: "Studio" }, () => "m-a");
    const b = normalize({ host: "192.0.2.10" }, () => "m-b");
    const again = normalize({ host: "studio.local", name: "Renamed" }, () => "m-new");
    const list = upsert(upsert([a], b), again);
    expect(list.map((c) => [c.id, c.name])).toEqual([
      ["m-a", "Renamed"],
      ["m-b", "192.0.2.10"],
    ]);
    expect(remove(list, "m-a").map((c) => c.id)).toEqual(["m-b"]);
  });

  it("loads what the store keeps, leaving out entries that do not pass, and saves the list", async () => {
    const bridge = fakeBridge({
      "store.get": () => ({
        value: [
          { id: "m-a", name: "Studio", host: "studio.local", port: 5900, password: "never" },
          { id: "m-b", host: "not a host" },
          "junk",
        ],
      }),
      "store.set": () => ({}),
    });
    const list = await loadComputers(bridge);
    expect(list).toEqual([{ id: "m-a", name: "Studio", host: "studio.local", port: 5900 }]);
    await saveComputers(bridge, list);
    expect(bridge.params("store.set")).toEqual([{ key: "computers", value: list }]);
    const many = Array.from({ length: 800 }, (_, i) =>
      normalize({ host: `mac-${i}.example.com`, name: "x".repeat(60) }, () => `m-${i}`),
    );
    await expect(saveComputers(bridge, many)).rejects.toThrow("Too many computers");
  });
});
