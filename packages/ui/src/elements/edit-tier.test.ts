import { beforeEach, describe, expect, it } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { DeskEditTier, defineElements, EDIT_TIERS } from "./index";
import { queryAll, reset } from "./test-dom";

defineElements();

const LOSSLESS = "Saving changes only the bytes you edit; the rest of the file stays as it was.";
const TEXT =
  "Saving keeps the content, not always the formatting. The first save makes a copy unless you choose to overwrite.";
const READ_ONLY = "This format opens for reading; it is not edited here.";

/** An edit tier element with `attributes`, put on the page, and its visible label. */
function tier(attributes: Record<string, string> = {}) {
  const element = document.createElement("desk-edit-tier");
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  const root = element.shadowRoot as unknown as Element;
  const label = queryAll(root, (el) => el.getAttribute("part") === "label")[0] as HTMLElement;
  if (!label) throw new Error("no label part");
  return { element, label };
}

describe("desk-edit-tier", () => {
  beforeEach(reset);

  it("knows the three tiers, in order", () => {
    expect(EDIT_TIERS).toEqual(["lossless", "text", "read-only"]);
    expect(document.createElement("desk-edit-tier")).toBeInstanceOf(DeskEditTier);
  });

  it("states each tier for its format, named once for screen readers", () => {
    const { element, label } = tier({ tier: "lossless", format: "CSV" });
    expect(element.tier).toBe("lossless");
    expect(label.textContent).toBe("CSV · Lossless editing");
    expect(label.getAttribute("title")).toBe(LOSSLESS);
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("role")).toBe("note");
    expect(element.getAttribute("aria-label")).toBe(`CSV: Lossless editing. ${LOSSLESS}`);

    element.setAttribute("tier", "text");
    element.setAttribute("format", "YAML");
    expect(label.textContent).toBe("YAML · Text editing");
    expect(label.getAttribute("title")).toBe(TEXT);
    expect(element.getAttribute("aria-label")).toBe(`YAML: Text editing. ${TEXT}`);

    element.setAttribute("tier", "read-only");
    element.removeAttribute("format");
    expect(label.textContent).toBe("Read-only");
    expect(element.getAttribute("aria-label")).toBe(`Read-only. ${READ_ONLY}`);
  });

  it("reads a missing or unknown tier as read-only", () => {
    const missing = tier({ format: "XLSX" });
    expect(missing.element.tier).toBe("read-only");
    expect(missing.label.textContent).toBe("XLSX · Read-only");
    const unknown = tier({ tier: "lossy", format: "XLSX" });
    expect(unknown.element.tier).toBe("read-only");
    expect(unknown.label.getAttribute("title")).toBe(READ_ONLY);
  });

  it("takes its words from label and detail when they are set, for translations", () => {
    const { element, label } = tier({
      tier: "lossless",
      format: "CSV",
      label: "무손실 편집",
      detail: "저장하면 고친 바이트만 바뀝니다.",
    });
    expect(label.textContent).toBe("CSV · 무손실 편집");
    expect(label.getAttribute("title")).toBe("저장하면 고친 바이트만 바뀝니다.");
    expect(element.getAttribute("aria-label")).toBe(
      "CSV: 무손실 편집. 저장하면 고친 바이트만 바뀝니다.",
    );
    element.removeAttribute("label");
    expect(label.textContent).toBe("CSV · Lossless editing");
  });

  it("keeps a role the page gave it", () => {
    const { element } = tier({ tier: "text", role: "status" });
    expect(element.getAttribute("role")).toBe("status");
  });
});
