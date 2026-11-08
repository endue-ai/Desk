// Save a page as Blink does: headless Chrome loads it and writes Page.captureSnapshot's MHTML and
// the DOM it ended with (Chrome's "--dump-dom"). Used by real.sh: node capture.mjs <url> <out>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [url, out] = process.argv.slice(2);
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--remote-debugging-port=9333",
    "--user-data-dir=/tmp/web-capture",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch("http://127.0.0.1:9333/json/list")
      .then((r) => r.json())
      .catch(() => undefined);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((done) => ws.addEventListener("open", done));
  let id = 0;
  const answers = new Map();
  let loaded = false;
  const send = (method, params = {}) =>
    new Promise((done) => {
      answers.set(++id, done);
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    answers.get(data.id)?.(data);
    if (data.method === "Page.loadEventFired") loaded = true;
    // The sample page calls alert(): accept it, as a person would.
    if (data.method === "Page.javascriptDialogOpening")
      void send("Page.handleJavaScriptDialog", { accept: true });
  });
  await send("Page.enable");
  await send("Page.navigate", { url });
  for (let i = 0; i < 50 && !loaded; i++) await sleep(100);
  await sleep(300);
  const snapshot = await send("Page.captureSnapshot", { format: "mhtml" });
  writeFileSync(`${out}.mhtml`, snapshot.result.data);
  const dom = await send("Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  });
  writeFileSync(`${out}.dom.html`, `<!DOCTYPE html>\n${dom.result.result.value}`);
  ws.close();
} finally {
  chrome.kill();
}
