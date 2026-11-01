import { describe, expect, it } from "vitest";
import { BRIDGE_METHODS, NAME } from "./index";

describe("@endue-ai/bridge", () => {
  it("exports its package name", () => {
    expect(NAME).toBe("@endue-ai/bridge");
  });

  it("lists the thirteen methods of the data, connector, view and catalog namespaces", () => {
    const integration = BRIDGE_METHODS.filter((m) => /^(data|connector|view|catalog)\./.test(m));
    expect(integration).toEqual([
      "data.query",
      "data.get",
      "data.subscribe",
      "data.unsubscribe",
      "connector.list",
      "connector.connect",
      "connector.disconnect",
      "connector.sync",
      "view.list",
      "view.get",
      "view.save",
      "view.remove",
      "catalog.get",
    ]);
  });
});
