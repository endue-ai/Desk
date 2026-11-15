// What the terminal fixture's scripted PTY prints (issue 319): what a plain modern terminal draws,
// one row each, and a made-up prompt. Nothing in it comes from the machine, so a screenshot of it
// holds no one's name, folder or history.
const ESC = "\x1b";
const BEL = "\x07";
const CSI = `${ESC}[`;
const sgr = (codes: string, text: string) => `${CSI}${codes}m${text}${CSI}0m`;

/** The sixteen colours as blocks, normal then bright. */
const sixteen = () =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sgr(`3${i}`, "██")).join("") +
  " " +
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sgr(`9${i}`, "██")).join("");

/** The 256-colour cube's first green row and the grey ramp. */
const indexed = () =>
  Array.from({ length: 24 }, (_, i) => sgr(`48;5;${22 + i * 8}`, " ")).join("") +
  " " +
  Array.from({ length: 24 }, (_, i) => sgr(`48;5;${232 + i}`, " ")).join("");

/** A truecolor ramp from red through green to blue. */
const truecolor = () =>
  Array.from({ length: 49 }, (_, i) => {
    const t = i / 48;
    const r = Math.round(255 * Math.max(0, 1 - 2 * t));
    const g = Math.round(255 * (1 - Math.abs(2 * t - 1)));
    const b = Math.round(255 * Math.max(0, 2 * t - 1));
    return sgr(`48;2;${r};${g};${b}`, " ");
  }).join("");

const styles = [
  sgr("1", "bold"),
  sgr("2", "dim"),
  sgr("3", "italic"),
  sgr("4", "under"),
  sgr("4:2", "double"),
  sgr("4:3", "curly"),
  sgr("4:4", "dotted"),
  sgr("4:5", "dashed"),
  sgr("4:3;58;2;230;60;60", "red curl"),
  sgr("7", "inverse"),
  sgr("9", "strike"),
  sgr("53", "over"),
].join(" ");

const link = `${ESC}]8;;https://example.com/${BEL}example.com${ESC}]8;;${BEL}`;

/** The rows, with a label of their own each, then the prompt. */
export const PATTERN = [
  `${ESC}]2;demo${BEL}${sgr("1", "endue desk terminal")} ${sgr("2", "test pattern")}`,
  "",
  `16 colours   ${sixteen()}`,
  `256 colours  ${indexed()}`,
  `truecolor    ${truecolor()}`,
  `styles       ${styles}`,
  "boxes        ┌──┬──┐ ╭──╮ ▁▂▃▄▅▆▇█ ░▒▓ ⣿⡇",
  "             ├──┼──┤ │  │ ▏▎▍▌▋▊▉█ ◢◣◤◥",
  "             └──┴──┘ ╰──╯ ←↑→↓ ✓ ✗ ★",
  "wide         한글 터미널 漢字 かな 😀 🚀",
  `link         ${link}`,
  "",
  `${sgr("32", "demo@desk")} ${sgr("34", "~/demo")} % `,
].join("\r\n");
