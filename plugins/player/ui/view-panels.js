// The panels around the player: the audio card (cover, title, artist, album), the details view (what
// the file is and why it is not played), a subtitle file's cues with their times, and the side panel
// with the playlist and the chapters.
import { bytes, clock, cueTime } from "./time.js";

/**
 * @typedef {import("./player.js").Model} Model
 * @typedef {import("./probe/index.js").Track} Track
 * @typedef {(name: string, ...args: unknown[]) => unknown} Act
 */

const CUE_PAGE = 1000;

/** A track's facts in one phrase: 1920 × 1080, 2 channels, 48 kHz, 16-bit, kor. */
export function trackFacts(/** @type {Track} */ t) {
  const parts = [];
  if (t.width && t.height) parts.push(`${t.width} × ${t.height}`);
  if (t.channels)
    parts.push(t.channels === 1 ? "mono" : t.channels === 2 ? "stereo" : `${t.channels} channels`);
  if (t.sampleRate)
    parts.push(
      t.sampleRate >= 1e6
        ? `${(t.sampleRate / 1e6).toFixed(4)} MHz`
        : `${Math.round(t.sampleRate / 100) / 10} kHz`,
    );
  if (t.bits) parts.push(`${t.bits}-bit`);
  if (t.language) parts.push(t.language);
  if (t.name) parts.push(t.name);
  return parts.join(", ");
}

const KINDS = { video: "Video", audio: "Audio", subtitle: "Subtitles", other: "Other" };

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {(seconds: number) => void} seek
 */
export function createPanels(doc, act, seek) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const make = (
    /** @type {string} */ tag,
    /** @type {string} */ text = "",
    /** @type {string} */ className = "",
  ) => {
    const element = doc.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  /** A definition list from [term, value] pairs, empty values left out. */
  const fill = (
    /** @type {HTMLElement} */ list,
    /** @type {Array<[string, string | undefined]>} */ pairs,
  ) =>
    list.replaceChildren(
      ...pairs
        .filter(([, value]) => value)
        .flatMap(([term, value]) => [make("dt", term), make("dd", value)]),
    );

  const card = byId("card");
  const cover = /** @type {HTMLImageElement} */ (byId("cover"));
  const details = byId("details");
  const cuelist = byId("cuelist");
  const cueRows = byId("cue-rows");
  const more = byId("more-cues");
  const side = byId("side");
  const rows = byId("rows");
  const chapters = byId("chapters");
  /** @type {import("./subtitles.js").Cue[]} */
  let cues = [];
  let cuesShown = 0;
  /** @type {HTMLElement[]} */
  let chapterButtons = [];
  /** @type {Model["chapters"]} */
  let chapterList = [];

  const moreCues = () => {
    const page = cues.slice(cuesShown, cuesShown + CUE_PAGE).map((cue) => {
      const row = make("tr");
      row.append(
        make("td", cueTime(cue.start)),
        make("td", cueTime(cue.end)),
        make("td", cue.text, "cue-text"),
      );
      return row;
    });
    cueRows.append(...page);
    cuesShown += page.length;
    more.hidden = cuesShown >= cues.length;
  };
  more.addEventListener("click", moreCues);

  return {
    /** The audio card: the cover or a placeholder, and the tags. */
    card(/** @type {Model | null} */ model) {
      const audio = model?.mode === "media" && model.element === "audio";
      card.hidden = !audio;
      if (!audio || !model) return;
      cover.hidden = !model.cover;
      byId("no-cover").hidden = !!model.cover;
      if (model.cover) cover.src = model.cover;
      else cover.removeAttribute("src");
      const tags = model.info?.tags ?? {};
      fill(byId("tags"), [
        ["Title", tags.title ?? model.item?.name ?? model.name],
        ["Artist", tags.artist],
        ["Album", tags.album],
      ]);
    },

    /** The details view: the file, what it is, and why it is not played. */
    details(/** @type {Model | null} */ model) {
      const shown = model?.mode === "details";
      details.hidden = !shown;
      if (!shown || !model) return;
      byId("why").textContent = model.why ?? "";
      const info = model.info;
      const tags = info?.tags ?? {};
      fill(byId("facts"), [
        ["Name", model.item?.name ?? model.name],
        ["Size", model.size > 0 ? bytes(model.size) : undefined],
        ["Format", model.format],
        ["Duration", info?.duration ? clock(info.duration) : undefined],
        ["Title", tags.title],
        ["Artist", tags.artist],
        ["Album", tags.album],
        ["Year", tags.year],
      ]);
      const table = byId("tracks");
      const tracks = info?.tracks ?? [];
      table.hidden = tracks.length === 0;
      table.querySelector("tbody")?.replaceChildren(
        ...tracks.map((t) => {
          const row = make("tr");
          row.append(
            make("td", KINDS[t.kind]),
            make("td", t.codecId && t.codecId !== t.codec ? `${t.codec} (${t.codecId})` : t.codec),
            make("td", trackFacts(t)),
          );
          return row;
        }),
      );
    },

    /** A subtitle file's cues, a thousand at a time. */
    cues(/** @type {Model | null} */ model) {
      const shown = model?.mode === "cues";
      cuelist.hidden = !shown;
      const next = shown ? (model?.cues ?? []) : [];
      if (next === cues || (next.length === cues.length && next[0] === cues[0])) return;
      cues = next;
      cuesShown = 0;
      cueRows.replaceChildren();
      moreCues();
    },

    /** The playlist and the chapters. */
    side(/** @type {Model | null} */ model) {
      const list = model?.playlist?.rows ?? [];
      const marks = model?.chapters ?? [];
      side.hidden = list.length < 2 && marks.length === 0;
      byId("rows-title").hidden = list.length < 2;
      rows.hidden = list.length < 2;
      rows.replaceChildren(
        ...list.map((row, index) => {
          const item = make("li", "", row.state);
          const label = row.detail ? `${row.title} (${row.detail})` : row.title;
          if (row.state === "remote" || row.state === "missing") item.append(make("span", label));
          else {
            const button = make("button", label);
            button.setAttribute("type", "button");
            if (row.state === "playing") button.setAttribute("aria-current", "true");
            button.addEventListener("click", () => act("pick", index));
            item.append(button);
          }
          return item;
        }),
      );
      byId("chapters-title").hidden = marks.length === 0;
      chapters.hidden = marks.length === 0;
      if (marks !== chapterList) {
        chapterList = marks;
        chapterButtons = marks.map((chapter) => {
          const button = make("button", `${chapter.title} · ${clock(chapter.start)}`);
          button.setAttribute("type", "button");
          button.addEventListener("click", () => seek(chapter.start));
          return button;
        });
        chapters.replaceChildren(
          ...chapterButtons.map((b) => {
            const item = make("li");
            item.append(b);
            return item;
          }),
        );
      }
    },

    /** Mark the chapter the position is in. */
    time(/** @type {number} */ now) {
      const at = (chapterList ?? []).findLastIndex((c) => c.start <= now);
      chapterButtons.forEach((b, i) => {
        if (i === at) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
    },
  };
}
