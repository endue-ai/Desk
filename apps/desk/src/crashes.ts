// Crash reports from the shell's window (#322). Uncaught errors and rejections go to the app's
// desk_crash command, which writes a redacted report in the data folder (crates/desk-crash); the
// same message once, five at most per run. At start the newest report not shown yet comes back from
// take_last_crash, and one card says so: Show report, Copy, close. Plugin frames are sandboxed and
// cross-origin, so only the shell's own errors are seen. Nothing is uploaded (ADR 0007).

/** The app commands this module calls. */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The most reports one run sends. */
export const MAX_REPORTS = 5;

function text(value: unknown): { message: string; stack: string } {
  if (value instanceof Error)
    return { message: `${value.name}: ${value.message}`, stack: value.stack ?? "" };
  return { message: String(value), stack: "" };
}

/** Send the window's uncaught errors and rejections to desk_crash; returns the function that stops. */
export function reportCrashes(win: Window, invoke: Invoke): () => void {
  const sent = new Set<string>();
  const send = (message: string, stack: string) => {
    if (!message || sent.has(message) || sent.size >= MAX_REPORTS) return;
    sent.add(message);
    void invoke("desk_crash", { message, stack }).catch(() => {});
  };
  const onError = (event: ErrorEvent) => {
    const { message, stack } = event.error === undefined ? text(event.message) : text(event.error);
    send(message || event.message, stack);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const { message, stack } = text(event.reason);
    send(`Unhandled rejection: ${message}`, stack);
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}

/**
 * The card for last time's crash, when there is a report not shown yet: "Desk crashed last time."
 * with Show report (the redacted JSON), Copy and a close button. Resolves with whether it showed.
 */
export async function showLastCrash(
  root: HTMLElement,
  invoke: Invoke,
  copy: (text: string) => Promise<void>,
): Promise<boolean> {
  const report = await invoke("take_last_crash").catch(() => null);
  if (!report) return false;
  const doc = root.ownerDocument;
  const json = JSON.stringify(report, null, 2);
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, string>,
    label?: string,
  ) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) node.setAttribute(key, value);
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const card = el("section", {
    class: "crash-card",
    role: "alertdialog",
    "aria-labelledby": "crash-title",
  });
  const title = el("p", { id: "crash-title", class: "crash-title" }, "Desk crashed last time.");
  const detail = el(
    "p",
    { class: "crash-detail" },
    "A report is kept on this computer. Nothing was sent.",
  );
  const show = el(
    "button",
    { type: "button", class: "btn btn-outline", "aria-expanded": "false" },
    "Show report",
  );
  const copyButton = el("button", { type: "button", class: "btn btn-outline" }, "Copy");
  const close = el(
    "button",
    { type: "button", class: "icon-button crash-close", "aria-label": "Close" },
    "×",
  );
  const body = el("pre", { class: "crash-report", tabindex: "0" }, json);
  body.hidden = true;
  show.addEventListener("click", () => {
    body.hidden = !body.hidden;
    show.setAttribute("aria-expanded", String(!body.hidden));
    show.textContent = body.hidden ? "Show report" : "Hide report";
  });
  copyButton.addEventListener("click", () => {
    void copy(json).then(
      () => {
        copyButton.textContent = "Copied";
      },
      () => {
        copyButton.textContent = "Copy failed";
      },
    );
  });
  close.addEventListener("click", () => card.remove());
  const actions = el("div", { class: "crash-actions" });
  actions.append(show, copyButton);
  card.append(close, title, detail, actions, body);
  root.append(card);
  return true;
}
