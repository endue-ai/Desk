// The shell's built-in page: shows what the Rust side reports at /_desk/status.json.
const state = document.getElementById("state");
const facts = document.getElementById("facts");
try {
  const response = await fetch("/_desk/status.json");
  const status = await response.json();
  state.textContent = "The desk-app scheme and the shell process answer.";
  for (const [name, value] of Object.entries(status)) {
    const dt = document.createElement("dt");
    dt.textContent = name;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    facts.append(dt, dd);
  }
  console.log(`desk-shell hello ${JSON.stringify(status)}`);
} catch (error) {
  state.textContent = `The shell did not answer: ${error}`;
  console.log(`desk-shell hello failed ${error}`);
}
