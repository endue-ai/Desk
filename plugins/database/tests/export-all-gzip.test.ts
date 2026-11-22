// A whole export compressed (PG-64): gzip through the platform's CompressionStream, chunk by chunk,
// inflates to exactly the plain file, in the plugin's writer and the server's bytes alike.
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canCompress, deflater } from "../ui/export/deflate.js";
import { optionsOf } from "../ui/export/options.js";
import { createPipe } from "../ui/export/pipe.js";

const META = { columns: ["id", "name"], oids: [23, 25], types: ["integer", "text"] };
const text = Array.from({ length: 5000 }, (_, i) => `${i}\tname ${i} ${"é".repeat(i % 7)}\n`).join(
  "",
);
const bytesOf = (outs: { content: string; encoding: string }[]) =>
  Buffer.concat(
    outs.map((o) => Buffer.from(o.content, o.encoding === "base64" ? "base64" : "utf8")),
  );

describe.skipIf(!canCompress())("compression", () => {
  it("compressed output inflates to the plain file", async () => {
    for (const format of ["json", "tsv"] as const) {
      const options = optionsOf(format, {});
      const run = async (gzip: boolean) => {
        const pipe = createPipe({
          format,
          options,
          meta: META,
          gzip,
          ...(format === "tsv" ? { direct: "text" as const } : {}),
        });
        const outs = [];
        for (let at = 0; at < text.length; at += 4096)
          outs.push(...(await pipe.push({ data: text.slice(at, at + 4096) })));
        outs.push(...(await pipe.end()));
        return bytesOf(outs);
      };
      const plain = await run(false);
      const packed = await run(true);
      expect(packed.length).toBeLessThan(plain.length);
      expect(gunzipSync(packed).equals(plain), format).toBe(true);
    }
    const d = deflater("gzip");
    expect(
      gunzipSync(Buffer.concat([...(await d.push(new Uint8Array())), ...(await d.end())])).length,
    ).toBe(0);
  });
});
