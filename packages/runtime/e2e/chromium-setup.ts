import { ensureHeadlessShell } from "../../../e2e/support/chrome-for-testing";

// Before any worker launches the browser: fetch the pinned headless shell once (e2e/chromium.ts).
export default async function setup(): Promise<void> {
  await ensureHeadlessShell();
}
