import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { check, LANGS, relativeLinks, translationPath } from "./docs-i18n.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "docs-i18n-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const line = LANGS.map((lang) => `[${lang}](docs/i18n/${lang}/GUIDE.md)`).join(" · ");
const translated = (lang) => [
  translationPath("GUIDE.md", lang),
  "> [English](../../../GUIDE.md)\n",
];

describe("docs-i18n", () => {
  it("every user-facing document in the repository ships its five translations", () => {
    assert.deepEqual(check(), []);
  });

  it("places translations under docs/i18n/<lang>/, without the docs/ prefix", () => {
    assert.equal(translationPath("README.md", "ja"), "docs/i18n/ja/README.md");
    assert.equal(
      translationPath("docs/plugins/authoring.md", "ko"),
      "docs/i18n/ko/plugins/authoring.md",
    );
  });

  it("keeps relative links and drops anchors and URLs", () => {
    assert.deepEqual(relativeLinks("[a](x.md#top) [b](https://endue.ai) [c](../y.md)"), [
      "x.md",
      "../y.md",
    ]);
  });

  it("passes a document with all five translations linked both ways", () => {
    const root = tree({
      "GUIDE.md": `# Guide\n\nEnglish · ${line}\n`,
      ...Object.fromEntries(LANGS.map(translated)),
    });
    assert.deepEqual(check(root, ["GUIDE.md"]), []);
  });

  it("names a missing translation, a missing language link, a missing link back and a broken link", () => {
    const files = Object.fromEntries(LANGS.filter((lang) => lang !== "de").map(translated));
    files[translationPath("GUIDE.md", "fr")] = "> pas de lien\n";
    files[translationPath("GUIDE.md", "ko")] = "> [English](../../../GUIDE.md) [x](nowhere.md)\n";
    const root = tree({ "GUIDE.md": "# Guide\n\n[ja](docs/i18n/ja/GUIDE.md)\n", ...files });
    const problems = check(root, ["GUIDE.md"]);
    assert.ok(problems.includes("GUIDE.md: no de translation at docs/i18n/de/GUIDE.md"));
    assert.ok(problems.includes("GUIDE.md: the language line does not link docs/i18n/zh/GUIDE.md"));
    assert.ok(problems.includes("docs/i18n/fr/GUIDE.md: does not link back to GUIDE.md"));
    assert.ok(problems.includes("docs/i18n/ko/GUIDE.md: broken link nowhere.md"));
  });
});
