export const sessionCss = `
:host {display:block;container-type:inline-size;min-width:0;min-height:0;height:100%;color:var(--desk-text);background:var(--desk-background);font:var(--desk-text-sm) / 1.5 var(--desk-font-sans)}
* {box-sizing:border-box;min-width:0}
[hidden] {display:none !important}
.shell {display:grid;grid-template-columns:minmax(150px,22%) minmax(0,1fr) minmax(170px,25%);height:100%;overflow:hidden;border:1px solid var(--desk-border);border-radius:var(--desk-radius-lg)}
.shell[data-detail="off"] {grid-template-columns:minmax(150px,24%) minmax(0,1fr)}
.shell[data-detail="off"] .details {display:none}
h2,h3,h4,p,dl,dd,pre {margin:0}
h2 {font-size:var(--desk-text-xl);line-height:1.25;letter-spacing:var(--desk-tracking);overflow-wrap:anywhere}
h3 {font-size:var(--desk-text-base);line-height:1.3}
h4,.author {font-size:var(--desk-text-xs);font-weight:650}
h4 {margin:var(--desk-space-5) 0 var(--desk-space-2)}
button,input,select,summary {font:inherit;color:inherit}
button,summary {cursor:pointer}
button {border:0;background:transparent;text-align:start;border-radius:var(--desk-radius-sm);padding:var(--desk-space-1) var(--desk-space-2);line-height:1.4}
button:hover,summary:hover,button[aria-current="true"],button[aria-pressed="true"] {background:var(--desk-hover)}
button:disabled {color:var(--desk-text-muted);cursor:default}
:focus-visible {outline:var(--desk-focus-width) solid var(--desk-ring);outline-offset:-2px}
.muted,.row-meta,.facts dt,.author,time,.breadcrumb,.sign {color:var(--desk-text-muted)}
time,.row-meta,.state {font-variant-numeric:tabular-nums}
.navigator,.details {display:flex;flex-direction:column;overflow:hidden;gap:var(--desk-space-2);padding:var(--desk-space-3)}
.navigator {background:var(--desk-muted);border-right:1px solid var(--desk-border)}
.navigator h3 {margin:var(--desk-space-1) 0 var(--desk-space-2)}
.search,select {width:100%;height:var(--desk-control-sm);border:1px solid var(--desk-input);border-radius:var(--desk-radius-md);background:var(--desk-card);padding:0 var(--desk-space-2)}
.scope {display:flex;flex-wrap:wrap;gap:var(--desk-space-1)}
.scope-button,.filters summary,.quiet,.tab,.outline,.jump {font-size:var(--desk-text-xs)}
.filters summary,.workspace,.earlier button {color:var(--desk-text-muted)}
.filters select {margin-top:var(--desk-space-1)}
.session-list,.detail-body {overflow:auto;min-height:0;scrollbar-width:thin}
.session-list {flex:1}
.workspace,.session,.peer {display:block;width:100%}
.workspace {font-weight:600;margin-top:var(--desk-space-3);overflow-wrap:anywhere}
.workspace::before {content:"▾";margin-right:var(--desk-space-1)}
.workspace[aria-expanded="false"]::before {content:"▸"}
.session {padding:var(--desk-space-2);margin:var(--desk-space-1) 0}
.row-title,.peer small {display:block}
.row-title {font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-meta,.subhead {display:flex;align-items:center;gap:var(--desk-space-2);flex-wrap:wrap;font-size:var(--desk-text-xs)}
.state {display:inline-flex;gap:var(--desk-space-1);align-items:center;font-size:var(--desk-text-xs)}
.state[data-state="working"] .sign {color:var(--desk-star)}
.state[data-state="waiting"] .sign {color:var(--desk-warning-text)}
.state[data-state="failed"] .sign,.problem,[data-role="failure"] .plain {color:var(--desk-danger-text)}
.reader {display:flex;flex-direction:column;overflow:hidden}
.reader-head {padding:var(--desk-space-3) var(--desk-space-4);border-bottom:1px solid var(--desk-border)}
.headbar,.pane-head,.detail-tabs {display:flex;align-items:center;gap:var(--desk-space-2)}
.headbar {margin-bottom:var(--desk-space-2)}
.headbar .detail-toggle,.pane-head button {margin-left:auto}
.breadcrumb {font-size:var(--desk-text-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.subhead {margin-top:var(--desk-space-1)}
.subhead .muted {overflow-wrap:anywhere}
.transcript {flex:1;min-height:0;overflow:auto;scrollbar-width:thin;overflow-anchor:none;padding:var(--desk-space-3) var(--desk-space-4)}
.turn {padding:var(--desk-space-2) 0 var(--desk-space-3);overflow-wrap:anywhere}
.turn[data-role="user"] {padding:var(--desk-space-3);margin:var(--desk-space-1) 0 var(--desk-space-3);background:var(--desk-muted);border-radius:var(--desk-radius-md)}
.author,time,.turn small {display:inline-block}
.turn time,.turn small {font-size:var(--desk-text-xs);margin-left:var(--desk-space-2)}
.plain,.preview-text,pre {white-space:pre-wrap;overflow-wrap:anywhere}
.turn p,.turn desk-markdown,.turn details,.preview-text {display:block;margin-top:var(--desk-space-1)}
.calls,.original,.event {border-top:1px solid var(--desk-border);border-bottom:1px solid var(--desk-border);padding:var(--desk-space-2) 0}
summary,.tool-line,.event {font-size:var(--desk-text-xs)}
.tool-line,.event {display:grid;gap:var(--desk-space-1);padding:var(--desk-space-2)}
pre {font-family:var(--desk-font-mono);font-size:var(--desk-text-xs);max-width:100%;overflow:auto}
.details {border-left:1px solid var(--desk-border);background:var(--desk-card)}
.pane-head {min-height:var(--desk-control-sm)}
.detail-tabs {border-bottom:1px solid var(--desk-border);padding-bottom:var(--desk-space-2)}
.detail-body {overflow-wrap:anywhere}
.facts {display:grid;grid-template-columns:auto 1fr;gap:var(--desk-space-2);font-size:var(--desk-text-xs)}
.peer {border-top:1px solid var(--desk-border);padding:var(--desk-space-2) 0}
.peer small,.detail-body .author {font-size:var(--desk-text-xs)}
.peer-title,.preview-text {margin-bottom:var(--desk-space-3)}
.outline,.jump {border:1px solid var(--desk-input);border-radius:var(--desk-radius-md)}
.jump,.request-link {align-self:center;margin:var(--desk-space-1)}
.request-link {text-decoration:underline}
.request {border-left:2px solid var(--desk-warning-text);padding-left:var(--desk-space-2)}
.request button {margin:var(--desk-space-1)}
.earlier,.read-note,.nav-tools {font-size:var(--desk-text-xs);color:var(--desk-text-muted)}
.composer {flex:none}
.nav-toggle {display:none}
@container (min-width:560px) and (max-width:719.99px) {
 .shell {grid-template-columns:minmax(0,1fr) minmax(170px,32%)}
 .shell[data-detail="on"] .navigator {display:none}
 .shell[data-detail="off"] {grid-template-columns:minmax(150px,32%) minmax(0,1fr)}
}
@container (max-width:559.99px) {
 .shell,.shell[data-detail="off"] {display:flex;flex-direction:column}
 .shell .navigator,.shell .reader,.shell .details {flex:1;border:0;min-height:0}
 .shell:not([data-pane="nav"]) .navigator,.shell:not([data-pane="reader"]) .reader,.shell:not([data-pane="details"]) .details {display:none}
 .nav-toggle {display:inline-block}
}
`;
