// The words (NET-18): every message the code reads is in both catalogs, the catalogs fit
// specs/plugin/v0's messages schema, the standard terms are used as they are, and no label, title
// or command name uses the drawing's metaphors (room number, name tag, door, lane, road).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { KINDS } from "../ui/kinds.js";
import { REFUSALS, refusalKeys } from "../ui/refusal.js";

const root = join(import.meta.dirname, "..");
const read = (lang: string) =>
  JSON.parse(readFileSync(join(root, "messages", `${lang}.json`), "utf8")) as Record<
    string,
    unknown
  >;
const en = read("en");
const ko = read("ko");
const texts = (catalog: Record<string, unknown>) =>
  Object.values(catalog).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v as object)));

/** Every message id the sources name literally, and those they build from a known list. */
function idsInSources() {
  const ids = new Set<string>();
  for (const name of readdirSync(join(root, "ui")).filter((n) => n.endsWith(".js"))) {
    const source = readFileSync(join(root, "ui", name), "utf8");
    for (const m of source.matchAll(/\bt\(\s*"([a-z][\w.]*)"/g)) ids.add(m[1] ?? "");
    for (const m of source.matchAll(/key: "([a-z][\w.]*)"/g)) ids.add(m[1] ?? "");
    for (const m of source.matchAll(/"(steps\.[a-z0-9]+)"/gi)) ids.add(m[1] ?? "");
  }
  for (const kind of KINDS) ids.add(`kind.${kind}`);
  for (const code of REFUSALS) for (const id of refusalKeys(code)) ids.add(id);
  for (const s of ["known", "new", "caution"]) ids.add(`status.${s}`).add(`status.${s}.help`);
  for (const s of ["fast", "ok", "slow", "none"]) ids.add(`speed.${s}`);
  for (const s of ["free", "busy", "crowded"]) ids.add(`level.${s}`).add(`channels.verdict.${s}`);
  for (const s of ["move", "pick", "quiet"]) ids.add(`channels.verdict.${s}`);
  for (const s of ["good", "fair", "weak", "unknown"]) ids.add(`signal.${s}`);
  for (const s of ["good", "fair", "poor"]) ids.add(`grade.${s}`);
  for (const s of ["open", "wep", "wpa", "mixed", "wpa2"]) ids.add(`card.wifi.${s}`);
  for (const s of ["new", "back", "gone", "first"]) ids.add(`log.${s}`).add(`log.group.${s}`);
  for (const s of ["map", "checkup", "channels", "log"]) ids.add(`tab.${s}`);
  for (const s of ["locate", "sweep", "ping", "names", "ports", "wifi"]) ids.add(`busy.${s}`);
  for (const s of ["unknown", "ports", "wifi"]) ids.add(`item.${s}`);
  return ids;
}

describe("the message catalogs", () => {
  it("fit the messages schema, and Korean has every English id", () => {
    const ajv = new Ajv2020({ strict: true });
    const schema = JSON.parse(
      readFileSync(join(root, "../../specs/plugin/v0/messages.schema.json"), "utf8"),
    );
    const validate = ajv.compile(schema);
    expect(validate(en), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(ko), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it("hold every id the code reads", () => {
    const missing = [...idsInSources()].filter((id) => !(id in en));
    expect(missing).toEqual([]);
  });

  it("keep each text's parameters in both languages", () => {
    const params = (v: unknown) =>
      [
        ...new Set(
          texts({ v }).flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
        ),
      ].sort();
    for (const id of Object.keys(en)) expect(params(ko[id]), id).toEqual(params(en[id]));
  });

  it("use the standard terms as they are, each with a line of help", () => {
    expect(en["term.ipAddress"]).toBe("IP address");
    expect(en["term.macAddress"]).toBe("MAC address");
    expect(en["term.manufacturer"]).toBe("Manufacturer");
    expect(en["term.port"]).toBe("Port");
    expect(en["term.wifiChannel"]).toBe("Wi-Fi channel");
    expect(en["term.ping"]).toBe("Ping (ms)");
    expect(ko["term.ipAddress"]).toBe("IP 주소");
    expect(ko["term.macAddress"]).toBe("MAC 주소");
    expect(ko["term.manufacturer"]).toBe("제조사");
    expect(ko["term.port"]).toBe("포트");
    expect(ko["term.wifiChannel"]).toBe("Wi-Fi 채널");
    expect(ko["term.ping"]).toBe("핑(ms)");
    for (const id of Object.keys(en).filter((k) => k.startsWith("term."))) {
      const help = id.replace(/^term\./, "help.");
      expect(en[help], help).toBeTypeOf("string");
      expect(ko[help], help).toBeTypeOf("string");
    }
    expect(ko["device.randomMac"]).toBe("무작위 MAC 주소(휴대폰일 수 있음)");
    expect(ko["channels.verdict.move"]).toBe("채널 {channel} 혼잡, 채널 {best} 권장.");
    expect(ko["card.port"]).toBe("{device}: 포트 {port}({service}) 열림.");
  });

  it("never use the drawing's metaphors in a word, a title or a command name", () => {
    const korean =
      /(?<![가-힣])(방|문|도로|차선|명찰)(?:이|가|을|를|은|는|에|의|으로|로|과|와)?(?![가-힣])|방 ?번호/;
    const english = /\b(rooms?|doors?|lanes?|roads?|name ?tags?|hallways?)\b/i;
    for (const text of texts(ko)) expect(korean.test(String(text)), String(text)).toBe(false);
    for (const text of texts(en)) expect(english.test(String(text)), String(text)).toBe(false);
    const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
    const words = [
      manifest.name,
      manifest.description,
      ...manifest.surfaces.map((s: { title: string }) => s.title),
      ...manifest.contributes.commands.flatMap(
        (c: { id: string; title: string; keywords?: string[]; description?: string }) => [
          c.id,
          c.title,
          c.description ?? "",
          ...(c.keywords ?? []),
        ],
      ),
    ];
    for (const word of words) {
      expect(english.test(word), word).toBe(false);
      expect(korean.test(word), word).toBe(false);
    }
  });
});
