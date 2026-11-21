// The CEF shell's word about the plugin frames it saw go (#44, #378): a renderer that died
// (`desk://frame-crashed`, `crashes.rs`) and a page it loaded again by itself after it stopped
// painting (`desk://frame-reloaded`, `web_host/revive.rs`) reach the runtime's frames by plugin, under
// the names the shell sends them by.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFrameSignals } from "./frame-signals";

const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("./host", () => ({ listen: native.listen }));

const SHELL = join(import.meta.dirname, "../shell/src");

/** The event a `pub const` of the shell's Rust names. */
function named(file: string, constant: string): string {
  const source = readFileSync(join(SHELL, file), "utf8");
  const found = source.match(new RegExp(`pub const ${constant}: &str = "([^"]+)";`))?.[1];
  if (!found) throw new Error(`${file} names no ${constant}`);
  return found;
}

const heard = new Map<string, (event: { payload: unknown }) => void>();
const offs = new Map<string, () => void>();

beforeEach(() => {
  vi.resetAllMocks();
  heard.clear();
  offs.clear();
  native.listen.mockImplementation(async (event: string, handler) => {
    heard.set(event, handler);
    const off = vi.fn();
    offs.set(event, off);
    return off;
  });
});

const frames = () => ({ crashed: vi.fn((_id: string) => true), loadedAgain: vi.fn() });

describe("the shell's word about plugin frames", () => {
  it("hands the shell's word that it loaded a plugin's page again to the runtime's frames", () => {
    const reloaded = named("web_host/revive.rs", "RELOADED");
    const f = frames();
    installFrameSignals(f);
    expect(native.listen).toHaveBeenCalledWith(reloaded, expect.any(Function));
    heard.get(reloaded)?.({ payload: { plugin: "example.notes" } });
    expect(f.loadedAgain).toHaveBeenCalledWith("example.notes");
    expect(f.crashed).not.toHaveBeenCalled();
  });

  it("hands a renderer's death to the frames by the name crashes.rs sends", () => {
    const crashed = named("crashes.rs", "CRASHED");
    const f = frames();
    installFrameSignals(f);
    heard.get(crashed)?.({ payload: { plugin: "example.notes" } });
    expect(f.crashed).toHaveBeenCalledWith("example.notes");
    expect(f.loadedAgain).not.toHaveBeenCalled();
  });

  it("does nothing for a payload that names no plugin", () => {
    const f = frames();
    installFrameSignals(f);
    for (const handler of heard.values()) {
      handler({ payload: {} });
      handler({ payload: { plugin: 7 } });
      handler({ payload: null });
    }
    expect(f.crashed).not.toHaveBeenCalled();
    expect(f.loadedAgain).not.toHaveBeenCalled();
  });

  it("stops both listeners when disposed", async () => {
    const dispose = installFrameSignals(frames());
    dispose();
    await vi.waitFor(() => expect(offs.size).toBe(2));
    await vi.waitFor(() => {
      for (const off of offs.values()) expect(off).toHaveBeenCalledOnce();
    });
  });
});
