// What a person typed, as the address the Browser loads (ui/address.js).
import { describe, expect, it } from "vitest";
import { addressOf, SEARCH, searchFor } from "../ui/address.js";

describe("an address typed into the Browser", () => {
  it("is loaded as it is when it is an http or https address", () => {
    expect(addressOf("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
    expect(addressOf("  HTTP://Example.com  ")).toBe("http://example.com/");
  });

  it("gets https in front when it is a bare host, with its path and port", () => {
    expect(addressOf("example.com")).toBe("https://example.com/");
    expect(addressOf("docs.example.com/guide?page=2")).toBe(
      "https://docs.example.com/guide?page=2",
    );
    expect(addressOf("example.com:8443/x")).toBe("https://example.com:8443/x");
  });

  it("gets http in front for this computer and plain numbers", () => {
    expect(addressOf("localhost:3000")).toBe("http://localhost:3000/");
    expect(addressOf("127.0.0.1:8791/b")).toBe("http://127.0.0.1:8791/b");
    expect(addressOf("[::1]:8080")).toBe("http://[::1]:8080/");
  });

  it("is searched for when it is words, or an address the Browser never loads", () => {
    const q = (words: string) => SEARCH.replace("%s", encodeURIComponent(words));
    expect(addressOf("endue desk")).toBe(q("endue desk"));
    expect(addressOf("what is 2+2?")).toBe(q("what is 2+2?"));
    expect(addressOf("localhost")).toBe("http://localhost/");
    expect(addressOf("notahost")).toBe(q("notahost"));
    for (const other of ["file:///etc/passwd", "javascript:alert(1)", "desk-plugin://main.x-y/a"])
      expect(addressOf(other)).toBe(q(other));
  });

  it("is nothing when nothing was typed", () => {
    expect(addressOf("")).toBeUndefined();
    expect(addressOf("   ")).toBeUndefined();
  });

  it("searches where the setting says, when that is a web address with a place for the words", () => {
    expect(addressOf("a b", "https://search.example/?q=%s&x=1")).toBe(
      "https://search.example/?q=a%20b&x=1",
    );
    for (const bad of ["https://search.example/", "ftp://x/%s", "not a url %s", ""])
      expect(searchFor("a b", bad)).toBe(SEARCH.replace("%s", "a%20b"));
  });
});
