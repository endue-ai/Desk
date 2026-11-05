// The shadow CSS of desk-universal-view: tokens only, so a theme restyles every presentation.
export const universalCss = `
:host {
  display: block;
  box-sizing: border-box;
  min-height: 0;
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-sm);
}
:host([hidden]) {
  display: none;
}
.view {
  display: flex;
  flex-direction: column;
  gap: var(--desk-space-2);
  height: 100%;
  min-height: 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--desk-space-2);
}
.title {
  flex: 1 1 auto;
  margin: 0;
  font-size: var(--desk-text-base);
  font-weight: 600;
}
.switch,
.nav {
  display: flex;
  gap: var(--desk-space-1);
}
button {
  min-height: var(--desk-control-sm);
  padding: 0 var(--desk-space-3);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-xs);
  cursor: pointer;
}
button:hover {
  background: var(--desk-hover);
}
button[aria-selected="true"] {
  border-color: var(--desk-primary-border);
  background: var(--desk-border);
  color: var(--desk-primary-text);
}
button:focus-visible,
.entry:focus-visible,
textarea:focus-visible {
  outline: var(--desk-focus-width) solid var(--desk-ring);
  outline-offset: 1px;
}
.status {
  padding: var(--desk-space-3);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  color: var(--desk-text-muted);
}
.status[data-state="error"],
.status[data-state="denied"] {
  border-color: var(--desk-danger-border);
  color: var(--desk-danger-text);
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
[role="list"] {
  display: flex;
  flex-direction: column;
  gap: var(--desk-space-1);
  margin: 0;
  padding: 0;
}
.entry {
  display: grid;
  gap: 2px var(--desk-space-2);
  padding: var(--desk-space-2) var(--desk-space-3);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  cursor: pointer;
}
.entry:hover {
  background: var(--desk-hover);
}
.entry[data-past] {
  opacity: 0.6;
}
.entry[data-current] {
  border-color: var(--desk-primary-border);
}
.entry-title {
  font-weight: 500;
}
.entry-detail,
.time,
.day,
.author,
.summary {
  color: var(--desk-text-muted);
  font-size: var(--desk-text-xs);
}
.time {
  font-variant-numeric: tabular-nums;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--desk-space-1);
}
.tag,
.badge {
  padding: 0 var(--desk-space-2);
  border-radius: var(--desk-radius-full);
  background: var(--desk-muted);
  color: var(--desk-text-muted);
  font-size: var(--desk-text-2xs);
}
[data-tone="done"] .badge,
.badge[data-tone="done"] {
  color: var(--desk-success-text);
}
[data-tone="failed"] .badge,
.badge[data-tone="failed"] {
  color: var(--desk-danger-text);
}
[data-tone="running"] .badge,
.badge[data-tone="running"] {
  color: var(--desk-info-text);
}
[data-tone="waiting"] .badge,
.badge[data-tone="waiting"] {
  color: var(--desk-warning-text);
}
.day {
  margin: var(--desk-space-3) 0 var(--desk-space-1);
  font-weight: 600;
}
.day[data-today] {
  color: var(--desk-primary-text);
}
.timeline .entry {
  grid-template-columns: 96px 1fr;
}
.timeline .entry > :not(.time) {
  grid-column: 2;
}
[role="separator"] {
  height: 0;
  margin: var(--desk-space-1) 0;
  border-top: 2px solid var(--desk-primary);
}
.board {
  display: grid;
  grid-auto-columns: minmax(200px, 1fr);
  grid-auto-flow: column;
  gap: var(--desk-space-3);
  align-items: start;
}
.column {
  display: flex;
  flex-direction: column;
  gap: var(--desk-space-2);
  padding: var(--desk-space-2);
  border-radius: var(--desk-radius-lg);
  background: var(--desk-muted);
}
.column[data-over] {
  outline: 2px solid var(--desk-primary);
}
.column-title {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}
.calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-border);
  overflow: hidden;
}
.weekday {
  padding: var(--desk-space-1) var(--desk-space-2);
  background: var(--desk-card);
  color: var(--desk-text-muted);
  font-size: var(--desk-text-2xs);
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 88px;
  padding: var(--desk-space-1);
  background: var(--desk-card);
}
.cell[data-outside] {
  background: var(--desk-muted);
  color: var(--desk-text-muted);
}
.cell[data-today] .number {
  color: var(--desk-primary-text);
  font-weight: 700;
}
.cell .entry {
  padding: 1px var(--desk-space-1);
  font-size: var(--desk-text-xs);
}
.calendar[data-columns="1"] {
  grid-template-columns: minmax(0, 1fr);
}
.cell .entry[data-all-day] {
  border-color: var(--desk-primary-border);
  background: var(--desk-muted);
}
.chat {
  display: flex;
  flex-direction: column;
  gap: var(--desk-space-1);
}
.chat .entry {
  max-width: 80%;
  justify-self: start;
  align-self: flex-start;
  border-radius: var(--desk-radius-lg);
}
.chat .entry[data-mine] {
  align-self: flex-end;
  border-color: var(--desk-primary-border);
  background: var(--desk-muted);
}
.agent-head {
  display: flex;
  align-items: center;
  gap: var(--desk-space-2);
}
.agent .entry {
  grid-template-columns: auto 1fr auto;
}
.agent .entry > desk-markdown {
  grid-column: 1 / -1;
}
.agent .entry[data-tone="running"] {
  border-color: var(--desk-info-border);
}
.agent .entry[data-tone="failed"] {
  border-color: var(--desk-danger-border);
}
.text section {
  margin-bottom: var(--desk-space-4);
}
.text h2 {
  margin: 0 0 var(--desk-space-2);
  font-size: var(--desk-text-lg);
}
.text .entry {
  display: block;
  border-color: transparent;
  background: transparent;
}
.compose {
  display: flex;
  gap: var(--desk-space-2);
  align-items: flex-end;
}
textarea {
  flex: 1 1 auto;
  min-height: var(--desk-control-md);
  padding: var(--desk-space-2);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-background);
  color: var(--desk-text);
  font: inherit;
  resize: vertical;
}
:host([density="compact"]) {
  font-size: var(--desk-text-xs);
}
:host([density="compact"]) .entry {
  padding: 2px var(--desk-space-2);
}
:host([density="compact"]) .board {
  grid-auto-columns: minmax(160px, 1fr);
}
:host([density="compact"]) .cell {
  min-height: 56px;
}
`;
