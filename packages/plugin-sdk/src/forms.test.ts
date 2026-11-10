// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shimForms } from "./forms";

let stop: () => void = () => {};
let unblock: () => void = () => {};

/** Act as Chromium in a sandboxed frame without allow-forms: the engine's own submit never comes. */
function blockEngineSubmission(): void {
  const block = (event: Event) => {
    if (event.isTrusted) event.stopImmediatePropagation();
  };
  window.addEventListener("submit", block, true);
  unblock = () => window.removeEventListener("submit", block, true);
}

function form(html: string) {
  document.body.innerHTML = `<form>${html}</form>`;
  const element = document.querySelector("form") as HTMLFormElement;
  const heard: Array<{ submitter: Element | null }> = [];
  element.addEventListener("submit", (event) => {
    event.preventDefault();
    heard.push({ submitter: (event as SubmitEvent).submitter });
  });
  return { element, heard };
}

beforeEach(() => {
  vi.useFakeTimers();
  stop = shimForms(document);
});

afterEach(() => {
  stop();
  unblock();
  unblock = () => {};
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("forms in a frame whose engine blocks submission", () => {
  it("a submit button's click fires submit once, with its submitter", () => {
    blockEngineSubmission();
    const { heard } = form(`<input name="q" value="hi"><button type="submit">Go</button>`);
    const button = document.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(heard).toEqual([{ submitter: button }]);
  });

  it("Enter in a one-line field fires submit once; not while composing, nor in a textarea", () => {
    blockEngineSubmission();
    const { heard } = form(`<input name="q"><textarea></textarea><button>Send</button>`);
    const input = document.querySelector("input") as HTMLInputElement;
    const area = document.querySelector("textarea") as HTMLTextAreaElement;
    const enter = (target: Element, isComposing = false) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing,
          bubbles: true,
          cancelable: true,
        }),
      );
    enter(input, true);
    enter(area);
    vi.advanceTimersByTime(0);
    expect(heard).toEqual([]);
    enter(input);
    vi.advanceTimersByTime(0);
    expect(heard).toHaveLength(1);
  });

  it("a plugin that handled the click or the key itself is left alone", () => {
    blockEngineSubmission();
    const { heard } = form(`<input name="q"><button type="submit">Go</button>`);
    const button = document.querySelector("button") as HTMLButtonElement;
    button.addEventListener("click", (event) => event.preventDefault());
    button.click();
    vi.advanceTimersByTime(0);
    expect(heard).toEqual([]);
  });

  it("an invalid form is not submitted, and a novalidate one is", () => {
    blockEngineSubmission();
    const { element, heard } = form(`<input name="q" required><button>Go</button>`);
    (document.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(0);
    expect(heard).toEqual([]);
    element.noValidate = true;
    (document.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(0);
    expect(heard).toHaveLength(1);
  });

  it("form.requestSubmit() fires submit once", () => {
    blockEngineSubmission();
    const { element, heard } = form(`<input name="q" value="x"><button>Go</button>`);
    element.requestSubmit();
    expect(heard).toHaveLength(1);
  });
});

describe("forms where the engine submits", () => {
  it("a click is heard once, from the engine: the shim adds nothing", () => {
    const { heard } = form(`<input name="q" value="hi"><button type="submit">Go</button>`);
    (document.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(0);
    expect(heard).toHaveLength(1);
  });

  it("form.requestSubmit() is heard once", () => {
    const { element, heard } = form(`<input name="q" value="x"><button>Go</button>`);
    element.requestSubmit();
    vi.advanceTimersByTime(0);
    expect(heard).toHaveLength(1);
  });
});
