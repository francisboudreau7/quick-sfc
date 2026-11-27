/**
 * Builds docs/mockups/help/index.html: the Help view mockup (Learning qSFC, Reference, cheat
 * sheet), with real diagrams and the editor's own highlighting.   npx tsx scripts/mockup-help.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { renderSvg } from "../src/render/svg.js";
import { previewHtml } from "../app/importl5x.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = (src: string) => `<pre class="code">${previewHtml(src)}</pre>`;
const diagram = (src: string): string => {
  const r = compile(src, { fileName: "example.qsfc" });
  return r.graph && r.layout ? renderSvg(r.graph, r.layout, { look: "textbook" }) : "<p>(errors)</p>";
};
const problems = (src: string): string => {
  const d = compile(src, { fileName: "example.qsfc" }).diagnostics;
  return d.length
    ? d.map((x) => `<li class="${x.severity}"><b>${x.code}</b> line ${x.span.line}: ${esc(x.message)}</li>`).join("")
    : '<li class="ok">No problems</li>';
};
const playground = (src: string, note = "") => `
<div class="pg">
  <div class="pg-bar"><span class="pg-title">Playground</span>${note ? `<span class="pg-note">${note}</span>` : ""}
    <span class="sp"></span><button>Reset</button><button class="primary">Open in the editor</button></div>
  <div class="pg-body">
    <div class="pg-code" contenteditable="true" spellcheck="false">${code(src)}</div>
    <div class="pg-dia">${diagram(src)}</div>
  </div>
  <ul class="pg-problems">${problems(src)}</ul>
</div>`;

// ---- Learning: lesson 3 ------------------------------------------------------------------------
const lesson = `init idle
-- start_btn
step fill 5s
  on valve
-- fill.done
step drain
  on drain_valve
-- after 3s -> idle
`;
const learningToc = [
  "Steps and transitions",
  "Actions: driving outputs",
  "Time",
  "Choosing a path (select)",
  "Doing two things at once (parallel)",
  "Jumps and loops",
  "Tags, types and I/O",
  "Action qualifiers",
  "Several routines",
  "Reading the problems",
];
const learning = `
<div class="view">
  ${chrome("Learning")}
  <div class="cols">
    <nav class="toc"><div class="toc-h">Learning qSFC</div><ol>${learningToc
      .map((t, i) => `<li${i === 2 ? ' class="on"' : ""}><span class="n">${i + 1}</span>${t}</li>`)
      .join("")}</ol></nav>
    <main class="page">
      <div class="crumb">Lesson 3 of 10</div>
      <h2>Time</h2>
      <p class="lead">Every step has its own timer. Give it a preset; <code>.done</code> turns on when it runs out.</p>
      ${playground(lesson)}
      <div class="mini">
        <div><code>step fill 5s</code><span>preset: 5 s (units ms s m h, <code>1m30s</code>)</span></div>
        <div><code>fill.done</code><span>the preset has elapsed (also <code>fill.time</code>: ms active)</span></div>
        <div><code>-- after 3s</code><span>the step above has been active 3 s, no preset needed</span></div>
      </div>
      <div class="try">
        <h3>Try this</h3>
        <ol>
          <li>Make filling last 2 minutes. <button class="sol">Show a solution</button></li>
          <li>Stop filling early when <code>level_high</code> is on. <button class="sol open">Hide the solution</button>
            ${code("-- fill.done OR level_high\n")}</li>
          <li>Light <code>busy_lamp</code> while filling or draining.</li>
        </ol>
      </div>
      <div class="pager"><a>← Choosing a path</a><a class="next">Choosing a path (select) →</a></div>
    </main>
  </div>
</div>`;

// ---- Reference: select ------------------------------------------------------------------------
const select = `init wait
-- part_present
step measure 1s
select
  -- measure.done AND size_big
  step push_big
    on pusher_big
  -- big_out -> wait
|
  -- measure.done AND NOT size_big
  step push_small
    on pusher_small
  -- small_out -> wait
end
`;
const refToc: Array<[string, string[]]> = [
  ["Basics", ["Files and lines", "Names", "Comments", "Durations"]],
  ["Chart", ["Steps", "Transitions", "Conditions", "after", "Jumps", "Chains", "End of a chart"]],
  ["Branches", ["select", "parallel", "Nesting", "Merging legs"]],
  ["Actions", ["ST actions", "on, set, reset", "Qualifiers N S R L D P"]],
  ["Tags", ["Automatic tags and types", "tag lines and values", "Step members", "io block", "controller block"]],
  ["Program", ["program, course, author", "Routines", "call", "SFR and SFP", "uses", "Elements of other routines"]],
  ["Problems", ["Every message, by code"]],
];
const reference = `
<div class="view">
  ${chrome("Reference")}
  <div class="cols">
    <nav class="toc"><input class="search" placeholder="Search the reference"/>${refToc
      .map(([g, items]) => `<div class="toc-h">${g}</div><ul>${items.map((t) => `<li${t === "select" ? ' class="on"' : ""}>${t}</li>`).join("")}</ul>`)
      .join("")}</nav>
    <main class="page">
      <div class="crumb">Reference · Branches</div>
      <h2><code>select</code> — one leg runs</h2>
      ${code("select\n  -- condition\n  ...\n|\n  -- condition\n  ...\nend\n")}
      ${playground(select)}
      <h3>Rules</h3>
      <ul class="rules">
        <li>Follows a step; each leg starts with a transition.</li>
        <li>Legs are tested left to right: the first true condition wins.</li>
        <li>A leg ends with a transition: a jump (<code>-&gt; wait</code>), or one that merges on the step after <code>end</code>.</li>
        <li>At least two legs, separated by <code>|</code>.</li>
      </ul>
      <h3>Problems you may see</h3>
      <table class="codes">
        <tr><td><b>E211</b></td><td><code>select</code> must follow a step</td><td><a>example</a></td></tr>
        <tr><td><b>E212</b></td><td>each leg must start with a transition</td><td><a>example</a></td></tr>
        <tr><td><b>E214</b></td><td>legs that don't jump need a step after <code>end</code></td><td><a>example</a></td></tr>
        <tr><td><b>E207</b></td><td>a branch needs at least 2 legs</td><td><a>example</a></td></tr>
      </table>
      <p class="also">See also: <a>parallel</a> · <a>Jumps</a> · <a>Merging legs</a></p>
    </main>
  </div>
</div>`;

// ---- Cheat sheet, reordered -------------------------------------------------------------------
const cs = (title: string, rows: Array<[string, string]>, extra = "") =>
  `<section><h3>${title}</h3><table>${rows.map(([a, b]) => `<tr><td>${code(a)}</td><td>${b}</td></tr>`).join("")}</table>${extra}</section>`;
const cheat = `
<div class="view">
  ${chrome("Cheat sheet")}
  <main class="page cheat">
    <div class="cheat-grid">
      ${cs("1 · A chart", [
        ["init idle", "initial step (one per chart)"],
        ["step fill 5s \"Fill\"", "step, preset, description"],
        ["-- start_btn", "transition"],
        ["-- go: a AND b", "named transition"],
        ["-- done -> idle", "jump"],
        ["// comment", "comment"],
      ])}
      ${cs("2 · Actions", [
        ["  valve [:=] 1;", "ST under the step (N)"],
        ["  on pump, fan", "on while active"],
        ["  set alarm", "latch on · reset alarm: off"],
        ["  S | R | L 5s | D 2s | P", "qualifier line starts an action"],
      ])}
      ${cs("3 · Time and step members", [
        ["fill.done   fill.DN", "preset elapsed"],
        ["fill.active fill.X", "step active"],
        ["fill.time   fill.T", "ms active"],
        ["-- after 5s", "step above active 5 s"],
      ])}
      ${cs("4 · Branches", [
        ["select\n  -- a\n  step x\n|\n  -- b\n  step y\nend", "one leg runs"],
        ["parallel\n  step x\n|\n  step y\nend", "all legs run; the next transition waits for all"],
      ])}
      ${cs("5 · Tags and I/O", [
        ["tag n : DINT = 5 \"desc\"", "type, value, description"],
        ["tag t1 : TIMER 3s", "timer preset"],
        ["io\n  start_btn  Local:1:I.Data.0\nend", "I/O names"],
      ])}
      ${cs("6 · Program", [
        ["program tank \"Title\"", "name and title"],
        ["st main\n  call fill;", "routines; the first one is main"],
        ["SFR(fill, idle);  SFP(fill, Pause);", "reset / pause a chart"],
        ["uses INIT, Main (main)", "routines not in this file"],
        ["controller\n  tag stop : BOOL\nend", "controller-scope tags"],
      ])}
    </div>
    <p class="muted">One page, in the order you write a chart. "Rules to remember" and "In the app" move to Learning and the Reference.</p>
  </main>
</div>`;

function chrome(active: string): string {
  return `<div class="chrome"><button class="back">← Back to the editor</button>
    <div class="tabs">${["Learning", "Reference", "Cheat sheet"].map((t) => `<button class="${t === active ? "on" : ""}">${t}</button>`).join("")}</div>
    <span class="sp"></span><button class="print">Print / open as a page</button></div>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Help view mockup</title>
<style>
:root { --bg:#e9ecf0; --surface:#fff; --s2:#f5f7f9; --line:#d5dae0; --fg:#1d2228; --muted:#59626e; --accent:#1a5fb4;
  --syn-kw:#8250df; --syn-comment:#6e7781; --syn-str:#0a3069; --syn-num:#0a6f7a; --syn-def:#953800; --syn-type:#116329; }
* { box-sizing:border-box; }
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
h1 { font-size:18px; margin:0 0 4px; } .lead0 { color:var(--muted); margin:0 0 14px; max-width:980px; }
.choices { background:#fff8e6; border:1px solid #e3c770; border-radius:8px; padding:10px 14px 10px 30px; max-width:1100px; margin:0 0 18px; }
.choices li { margin:3px 0; }
h2.part { font-size:15px; margin:22px 0 8px; }
.view { background:var(--surface); border:1px solid #b9c0c8; border-radius:10px; box-shadow:0 8px 24px rgba(16,24,40,.12); max-width:1180px; overflow:hidden; }
.chrome { display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--line); background:var(--s2); flex-wrap:wrap; }
.tabs { display:flex; gap:2px; background:#e4e8ec; border-radius:7px; padding:2px; }
.tabs button { border:0; background:transparent; padding:4px 12px; border-radius:5px; }
.tabs button.on { background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.12); font-weight:600; }
.sp { flex:1; }
button { font:inherit; font-size:13px; border-radius:6px; padding:4px 10px; border:1px solid #b9c0c8; background:#fff; cursor:pointer; }
button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.back { border:0; background:transparent; color:var(--accent); }
.cols { display:grid; grid-template-columns:230px 1fr; min-height:520px; }
.toc { border-right:1px solid var(--line); padding:12px; background:var(--s2); font-size:13.5px; }
.toc-h { font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:10px 0 4px; }
.toc ol, .toc ul { list-style:none; margin:0; padding:0; } .toc li { padding:4px 8px; border-radius:6px; }
.toc li.on { background:#dbe7f7; color:#0b3d7a; font-weight:600; } .toc .n { display:inline-block; width:20px; color:var(--muted); }
.search { width:100%; font:inherit; padding:5px 8px; border:1px solid var(--line); border-radius:6px; }
.page { padding:16px 22px 22px; min-width:0; }
.page h2 { margin:2px 0 4px; font-size:21px; } .page h3 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:18px 0 6px; }
.crumb { color:var(--muted); font-size:12.5px; } .lead { margin:0 0 12px; font-size:15px; }
code { font-family:ui-monospace,Consolas,monospace; font-size:12.5px; background:var(--s2); padding:1px 4px; border-radius:3px; }
pre.code { margin:0; font:12.5px/1.5 ui-monospace,Consolas,monospace; white-space:pre; background:var(--s2); padding:8px 10px; border-radius:6px; overflow-x:auto; }
.ip-k { color:var(--syn-kw); font-weight:600; } .ip-c { color:var(--syn-comment); font-style:italic; } .ip-s { color:var(--syn-str); }
.ip-n { color:var(--syn-num); } .ip-d { color:var(--syn-def); font-weight:600; } .ip-t, .ip-a { color:var(--syn-type); }
.pg { border:1px solid var(--line); border-radius:8px; overflow:hidden; margin:8px 0; }
.pg-bar { display:flex; align-items:center; gap:8px; padding:6px 10px; background:var(--s2); border-bottom:1px solid var(--line); }
.pg-title { font-weight:600; font-size:12.5px; } .pg-note { color:var(--muted); font-size:12.5px; }
.pg-body { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
.pg-code { padding:8px; border-right:1px solid var(--line); outline:none; } .pg-code pre.code { background:transparent; padding:2px; }
.pg-dia { padding:8px; background-image:radial-gradient(#d9dde3 1px, transparent 1px); background-size:12px 12px; overflow:auto; max-height:420px; }
.pg-dia svg { max-width:100%; height:auto; }
.pg-problems { list-style:none; margin:0; padding:5px 10px; border-top:1px solid var(--line); font-size:12.5px; }
.pg-problems .ok::before { content:"✓ "; color:#1a7f37; } .pg-problems .error { color:#b42318; } .pg-problems .warning { color:#8a5c00; }
.mini { display:grid; gap:4px; margin:10px 0; } .mini div { display:grid; grid-template-columns:150px 1fr; gap:10px; align-items:baseline; font-size:13.5px; }
.try { background:#f2f7ff; border:1px solid #c9dcf5; border-radius:8px; padding:4px 14px 10px; margin-top:14px; }
.try h3 { color:#0b3d7a; } .try ol { margin:0; padding-left:20px; } .try li { margin:6px 0; }
.sol { font-size:12px; padding:2px 8px; margin-left:6px; } .try pre.code { margin-top:6px; background:#fff; }
.pager { display:flex; justify-content:space-between; margin-top:18px; color:var(--accent); } .pager a:first-child { visibility:hidden; }
.rules { margin:0; padding-left:18px; } .rules li { margin:3px 0; }
table.codes { border-collapse:collapse; font-size:13.5px; } table.codes td { padding:3px 14px 3px 0; border-bottom:1px solid var(--line); }
table.codes a, .also a { color:var(--accent); }
.cheat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(330px, 1fr)); gap:4px 22px; }
.cheat section h3 { margin:10px 0 4px; border-bottom:1px solid var(--line); padding-bottom:3px; }
.cheat table { border-collapse:collapse; width:100%; } .cheat td { padding:3px 8px 3px 0; vertical-align:top; font-size:13px; }
.cheat td:first-child { width:55%; } .cheat pre.code { padding:3px 6px; }
.muted { color:var(--muted); font-size:12.5px; }
@media (max-width: 820px) { .cols { grid-template-columns:1fr; } .toc { border-right:0; border-bottom:1px solid var(--line); } .pg-body { grid-template-columns:1fr; } .pg-code { border-right:0; border-bottom:1px solid var(--line); } .mini div { grid-template-columns:1fr; } }
</style></head><body>
<h1>Help view (mockup)</h1>
<p class="lead0">Help → <b>Learning qSFC</b> / <b>Reference</b> / <b>Cheat sheet</b> open one view over the editor, with three tabs. Real diagrams and highlighting; the playground here is not live (in the app it is: edit the code, the diagram and the problems follow).</p>
<ol class="choices">
  <li><b>One Help view, three tabs.</b> F1 opens it on the cheat sheet; Esc or "Back to the editor" closes it and keeps your place. "Print / open as a page" gives the standalone page (printing, sharing).</li>
  <li><b>Learning: 10 short lessons</b> (list on the left), each = one or two sentences, a playground, a three-line summary, "Try this" with solutions. No product names; IEC SFC words (step, transition, action, qualifier).</li>
  <li><b>Playground:</b> the app's editor (highlighting, completion) and diagram (the look chosen in View), problems under it. Reset restores the example; "Open in the editor" copies it to a new, unsaved file. Edits are never saved. A Run button joins after Phase 4e.</li>
  <li><b>Reference: one entry per feature</b>, always the same order: syntax → playground → rules (≤ 5 bullets) → problems you may see (each with a one-click example) → see also. Search on top. A "Problems" page lists every code with an example that triggers it.</li>
  <li><b>Export and import</b> (the PLC file format) stay out of Learning; the Reference gets one short "Export and import" entry under Program, and the File-menu dialogs keep their own text.</li>
  <li><b>Cheat sheet reordered</b> in the order you write a chart (6 numbered blocks, one printed page); "Rules to remember" moves to Learning, "In the app" to a Reference entry.</li>
</ol>

<h2 class="part">A · Learning qSFC (lesson 3)</h2>
${learning}
<h2 class="part">B · Reference (the select entry)</h2>
${reference}
<h2 class="part">C · Cheat sheet, reordered</h2>
${cheat}
</body></html>
`;

mkdirSync("docs/mockups/help", { recursive: true });
writeFileSync("docs/mockups/help/index.html", html);
console.log("wrote docs/mockups/help/index.html");
