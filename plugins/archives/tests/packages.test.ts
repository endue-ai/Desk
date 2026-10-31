import { describe, expect, it } from "vitest";
import { detail, entry, expected, files, fixture, open, read, sha256, TREE } from "./fixtures";

describe("Debian packages", () => {
  for (const file of ["sample_1.0-1_all.deb", "sample-gzip.deb"]) {
    it(`${file}: the control fields above the data files`, async () => {
      const deb = await open(fixture(file), file);
      expect(deb.format).toBe("Debian package");
      expect(detail(deb, "Package")).toBe("sample");
      expect(detail(deb, "Version")).toBe("1.0-1");
      expect(detail(deb, "Architecture")).toBe("all");
      expect(detail(deb, "Description")).toBe("A sample package for the archives plugin's tests");
      expect(files(deb)).toEqual(["usr/share/doc/sample/hello.txt"]);
      expect(entry(deb, "usr/share/doc/sample/hello.txt")).toMatchObject({ size: 17 });
      expect(entry(deb, "usr/share/doc/sample/hello.txt").date).toBeInstanceOf(Date);
      expect(await read(deb, "usr/share/doc/sample/hello.txt")).toBe(TREE.hello);
    });
  }
});

describe("RPM packages", () => {
  for (const [file, payload] of [
    ["sample-gz.rpm", "gzip"],
    ["sample-xz.rpm", "xz"],
    ["sample-zst.rpm", "zstd"],
  ] as const) {
    it(`${file}: name, version, release and summary, then the ${payload} cpio payload`, async () => {
      const rpm = await open(fixture(file), file);
      expect(rpm.format).toBe("RPM package");
      expect(detail(rpm, "Name")).toBe("sample");
      expect(detail(rpm, "Version")).toBe("1.0");
      expect(detail(rpm, "Release")).toBe("1");
      expect(detail(rpm, "Summary")).toBe("A sample package for the archives plugin's tests");
      expect(detail(rpm, "Payload")).toBe(`cpio (${payload})`);
      expect(files(rpm)).toEqual(["opt/sample/hello.txt"]);
      expect(entry(rpm, "opt/sample/hello.txt")).toMatchObject({ size: 17 });
      expect(await read(rpm, "opt/sample/hello.txt")).toBe(TREE.hello);
    });
  }
});

describe("Ruby gems", () => {
  it("metadata.gz above data.tar.gz", async () => {
    const gem = await open(fixture("sample-1.0.0.gem"), "sample-1.0.0.gem");
    expect(gem.format).toBe("Ruby gem");
    expect(detail(gem, "Name")).toBe("sample");
    expect(detail(gem, "Version")).toBe("1.0.0");
    expect(detail(gem, "Summary")).toBe("A sample gem for the archives plugin's tests");
    expect(files(gem)).toEqual(["lib/hello.txt"]);
    expect(await read(gem, "lib/hello.txt")).toBe(TREE.hello);
  });
});

describe("xar and installer packages", () => {
  it("reads the zlib table of contents and gzip entries", async () => {
    const xar = await open(fixture("tree.xar"), "tree.xar");
    expect(xar.format).toBe("xar");
    expect(files(xar)).toEqual(["docs/readme.md", TREE.koreanName, "hello.txt"].sort());
    expect(entry(xar, "docs")).toMatchObject({ kind: "folder" });
    expect(entry(xar, "docs/readme.md")).toMatchObject({ size: 56 });
    expect(entry(xar, "docs/readme.md").date).toBeInstanceOf(Date);
    expect(await read(xar, "docs/readme.md")).toBe(TREE.readme);
    expect(await read(xar, TREE.koreanName)).toBe(TREE.korean);
  });

  it("reads bzip2 entries", async () => {
    const xar = await open(fixture("tree-bzip2.xar"), "tree-bzip2.xar");
    expect(entry(xar, "words.txt").method).toBe("bzip2");
    expect(sha256(await xar.read(entry(xar, "words.txt")))).toBe(expected.words.sha256);
  });

  it("a flat installer package lists its parts and its payload opens one level down", async () => {
    const pkg = await open(fixture("sample.pkg"), "sample.pkg");
    expect(pkg.format).toBe("Installer package");
    expect(files(pkg)).toEqual(expect.arrayContaining(["Bom", "PackageInfo", "Payload"]));
    expect(await read(pkg, "PackageInfo")).toContain('identifier="ai.endue.sample"');
    const payload = await open(await pkg.read(entry(pkg, "Payload")), "Payload");
    expect(payload.format).toBe("cpio (gzip)");
    expect(files(payload)).toEqual(["opt/sample/hello.txt"]);
    expect(await read(payload, "opt/sample/hello.txt")).toBe(TREE.hello);
  });
});

describe("cabinets", () => {
  it("reads MSZIP folders across several 32 KB blocks", async () => {
    const cab = await open(fixture("mszip.cab"), "mszip.cab");
    expect(cab.format).toBe("Cabinet");
    expect(files(cab)).toEqual(["docs/readme.md", "hello.txt", "words.txt"]);
    expect(entry(cab, "words.txt")).toMatchObject({ size: 48069, method: "MSZIP" });
    expect(entry(cab, "hello.txt").date).toBeInstanceOf(Date);
    expect(sha256(await cab.read(entry(cab, "words.txt")))).toBe(expected.words.sha256);
    expect(await read(cab, "docs/readme.md")).toBe(TREE.readme);
  });

  it("reads stored folders", async () => {
    const cab = await open(fixture("stored.cab"), "stored.cab");
    expect(entry(cab, "hello.txt").method).toBe("Stored");
    expect(await read(cab, "docs/readme.md")).toBe(TREE.readme);
  });
});

describe("Chrome extensions", () => {
  for (const [file, header] of [
    ["sample-v2.crx", "CRX 2"],
    ["sample-v3.crx", "CRX 3"],
  ] as const) {
    it(`skips the ${header} header and reads the ZIP behind it`, async () => {
      const crx = await open(fixture(file), file);
      expect(crx.format).toBe("ZIP");
      expect(detail(crx, "Header")).toBe(header);
      expect(files(crx)).toEqual(["hello.txt"]);
      expect(await read(crx, "hello.txt")).toBe(TREE.hello);
    });
  }
});
