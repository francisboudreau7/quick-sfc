/**
 * Builds docs/mockups/sim/index.html: Phase 4e mockup. The window in simulation (live diagram,
 * live tags, scan trace), the Help playground's Run, the `else` leg and the SFC logic checks.
 *   npx tsx scripts/mockup-sim.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { renderSvg } from "../src/render/svg.js";
import { previewHtml } from "../app/importl5x.js";

const SRC = [
  'program tank "Fill and mix"',
  "",
  "init idle",
  "-- start_btn",
  "step fill 5s",
  "  on valve",
  "-- fill.done",
  "step check",
  "select",
  "  -- level_ok",
  "  step mix 3s",
  "    on mixer",
  "  -- mix.done -> idle",
  "|",
  "  -- else",
  "  step alarm",
  "    set alarm_lamp",
  "  -- ack_btn -> idle",
  "end",
  "",
].join("\n");
// the mockup draws the chart with the `else` written out (the renderer doesn't know `else` yet)
const DRAWN = SRC.replace("-- else", "-- NOT level_ok");
const r = compile(DRAWN, { fileName: "tank.qsfc" });
const svg = renderSvg(r.graph!, r.layout!, { look: "textbook" });
const idOf = (name: string) => r.graph!.steps.find((s) => s.name === name)!.id;
const transAfter = (name: string) => r.graph!.transitions.find((t) => t.condition === name)!.id;

const lines = SRC.split("\n");
const hl = previewHtml(SRC).split("\n");
const editor = (activeLines: number[], runLines: number[]) =>
  lines
    .map((_, i) => {
      const n = i + 1;
      const mark = /^\s*(init|step)\b/.test(lines[i]!) ? (/^\s*init/.test(lines[i]!) ? '<span class="st st-s st-i">S</span>' : '<span class="st st-s">S</span>') : /^\s*--/.test(lines[i]!) ? '<span class="st st-t">T</span>' : /^\s*(select|\||end)\b/.test(lines[i]!) ? '<span class="st st-b">┆</span>' : '<span class="st"></span>';
      const cls = activeLines.includes(n) ? " active" : runLines.includes(n) ? " run" : "";
      return `<div class="ln${cls}">${mark}<span class="no">${n}</span><span class="tx">${hl[i] || "&nbsp;"}</span></div>`;
    })
    .join("");

const activeCss = (steps: string[], trueT: string[], falseT: string[], timers: Record<string, string>) => `
${steps.map((s) => `.dia [data-id="${idOf(s)}"] rect:first-of-type { fill: var(--sim-active-fill) !important; stroke: var(--sim-active) !important; stroke-width: 2.5px !important; }`).join("\n")}
${trueT.map((t) => `.dia [data-id="${transAfter(t)}"] > rect, .dia [data-id="${transAfter(t)}"] > line { stroke: var(--sim-true) !important; fill: var(--sim-true) !important; }`).join("\n")}
${falseT.map((t) => `.dia [data-id="${transAfter(t)}"] > rect, .dia [data-id="${transAfter(t)}"] > line { stroke: var(--sim-false) !important; fill: var(--sim-false) !important; }`).join("\n")}
${Object.keys(timers).length ? "" : ""}`;

const tag = (name: string, kind: "in" | "out" | "num", value: string, note = "") =>
  `<tr class="${kind}"><td>${kind === "in" ? `<button class="sw${value === "1" ? " on" : ""}" title="Click to toggle">${value === "1" ? "1" : "0"}</button>` : kind === "out" ? `<span class="lamp${value === "1" ? " on" : ""}"></span>` : `<input value="${value}" size="4">`}</td><td><b>${name}</b></td><td class="muted">${note}</td></tr>`;

const window1 = `
<div class="win">
  <div class="menubar"><b>qSFC</b><span>File</span><span>View</span><span>Insert</span><span>Help</span><span class="sp"></span>
    <span class="sim-bar"><button class="on">■ Stop simulation</button><button>▶ Play</button><button class="on">❚❚ Pause</button><button>Step</button><button>Reset</button>
    <select><option>×1</option><option>×10</option></select><span class="muted">scan 100 ms</span><span class="clock">t = 00:06.400 · scan 64</span></span></div>
  <div class="cols3">
    <div class="pane edit"><div class="pane-h">tank.qsfc <span class="badge">read-only while simulating</span></div>${editor([11], [12])}</div>
    <div class="pane dia"><div class="pane-h">Diagram <span class="muted">· active steps filled, transitions green when true, red when false</span></div>
      <div class="svgbox">${svg}</div><div class="timer-cap"><span class="timer">mix · 1.4 s / 3 s</span> <span class="muted">(this badge sits on the active step in the app)</span></div></div>
    <div class="pane tags"><div class="pane-h">Live tags</div>
      <table>
        <tr><th colspan="3" class="grp">Inputs <span class="muted">(click to change)</span></th></tr>
        ${tag("start_btn", "in", "0")}${tag("level_ok", "in", "1")}${tag("ack_btn", "in", "0")}
        <tr><th colspan="3" class="grp">Outputs</th></tr>
        ${tag("valve", "out", "0", "reset when fill ended")}${tag("mixer", "out", "1")}${tag("alarm_lamp", "out", "0", "stored (set)")}
        <tr><th colspan="3" class="grp">Steps</th></tr>
        <tr><td><span class="lamp"></span></td><td>idle</td><td class="muted">0 s</td></tr>
        <tr><td><span class="lamp"></span></td><td>fill</td><td class="muted">done · ran 5.0 s</td></tr>
        <tr><td><span class="lamp"></span></td><td>check</td><td class="muted">1 scan</td></tr>
        <tr><td><span class="lamp on"></span></td><td><b>mix</b></td><td class="muted">1.4 s of 3 s</td></tr>
        <tr><td><span class="lamp"></span></td><td>alarm</td><td class="muted"></td></tr>
      </table></div>
  </div>
  <div class="bottom"><div class="tabs"><span>Problems <b class="count">0</b></span><span class="on">Trace</span></div>
    <ol class="trace" reversed start="64">
      <li><b>scan 50</b> t 05.000 · <span class="t">-- fill.done</span> fires: <span class="s">fill</span> → <span class="s">check</span> (last scan of fill: valve := 0)</li>
      <li><b>scan 51</b> t 05.100 · select: <span class="t">-- level_ok</span> true → <span class="s">mix</span> (the <code>else</code> leg is false)</li>
      <li><b>scan 52…64</b> <span class="s">mix</span> active · mixer := 1</li>
      <li class="muted"><b>scan 1</b> t 00.000 · <span class="s">idle</span> active (initial step) · you set <b>start_btn</b> = 1 at scan 3, = 0 at scan 6</li>
    </ol></div>
</div>`;

const playground = `
<div class="pg">
  <div class="pg-bar"><b>Playground</b><span class="muted">edit me: the diagram follows</span><span class="sp"></span><button>Reset</button><button class="on">■ Stop</button><button class="primary">Open in the editor</button></div>
  <div class="pg-body">
    <div class="pg-code">${editor([5], [6])}</div>
    <div class="dia"><div class="svgbox small">${svg}</div></div>
  </div>
  <div class="pg-sim">▶ <b>Running</b> t = 03.200 · <span class="muted">Inputs:</span> <button class="sw">start_btn 0</button> <button class="sw on">level_ok 1</button> <button class="sw">ack_btn 0</button> <span class="muted">· Outputs:</span> <span class="lamp on"></span> valve <span class="lamp"></span> mixer <span class="lamp"></span> alarm_lamp</div>
</div>`;

const checks = [
  ["W700", "legs 1 and 2 of this select can both be true (when <code>ok AND big</code>): the first one wins", "select\n  -- ok\n  …\n|\n  -- big\n  …\nend", "write the second leg <code>-- else</code>, or <code>-- big AND NOT ok</code>"],
  ["W701", "<code>valve</code> is written in two parallel legs (lines 8 and 14): the last one written wins each scan", "parallel\n  step fill_a\n    on valve\n|\n  step fill_b\n    valve [:=] 0;\nend", "write it in one leg only"],
  ["W702", "the S action on <code>door_lock</code> (line 6) is never reset", "step heat\n  S\n    door_lock := 1;", "add an <code>R</code> action, or <code>reset door_lock</code>, in a later step"],
  ["W703", "step <code>wait</code> can never be left: its transition is always FALSE", "step wait\n-- FALSE -> idle", "check the condition"],
  ["W704", "the <code>else</code> leg can never run: the other legs cover every case", "select\n  -- x\n|\n  -- NOT x\n|\n  -- else\nend", "remove one of the legs"],
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulation mockup</title>
<style>
:root { --sim-active:#15803d; --sim-active-fill:#dcfce7; --sim-true:#15803d; --sim-false:#b42318;
  --syn-decl:#1f2328; --syn-decl-w:800; --syn-declname:#1f2328; --syn-stepkw:#b4440a; --syn-stepdef:#b4440a; --syn-target:#b4440a; --syn-ref:#b4440a; --syn-ref-w:600; --syn-ref-time:#0e7490;
  --syn-trans:#1d5fd1; --syn-label:#1d5fd1; --syn-branch:#7c3aed; --syn-action:#15803d; --syn-time:#0e7490; --syn-time-w:600; --syn-time-style:normal; --syn-value:#be185d; --syn-value-style:normal;
  --syn-logic:#1f2328; --syn-stctl:#1f2328; --syn-func:#1f2328; --syn-type:#6b7280; --syn-comment:#6b7280; --syn-op:#6b7280; }
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:#e9ecf0; color:#1d2228; }
h1 { font-size:18px; margin:0 0 4px; } h2 { font-size:15px; margin:22px 0 8px; } .lead { color:#59626e; max-width:1100px; margin:0 0 12px; }
.choices { background:#fff8e6; border:1px solid #e3c770; border-radius:8px; padding:10px 14px 10px 30px; max-width:1150px; }
.choices li { margin:3px 0; }
.muted { color:#6b7280; font-size:12.5px; }
button, select, input { font:inherit; font-size:12.5px; border:1px solid #b9c0c8; background:#fff; border-radius:5px; padding:2px 8px; }
button.on { background:#e6effa; border-color:#1a5fb4; color:#0b3d7a; } button.primary { background:#1a5fb4; color:#fff; border-color:#1a5fb4; }
.win { background:#fff; border:1px solid #b9c0c8; border-radius:10px; overflow:hidden; box-shadow:0 8px 24px rgba(16,24,40,.12); max-width:1300px; }
.menubar { display:flex; gap:14px; align-items:center; padding:6px 12px; background:#eef0f3; border-bottom:1px solid #d5dae0; flex-wrap:wrap; }
.sp { flex:1; } .sim-bar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; background:#e8f5ec; border:1px solid #9ad3ad; border-radius:7px; padding:3px 6px; }
.clock { font:12.5px ui-monospace,Consolas,monospace; margin-left:6px; }
.cols3 { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1.15fr) 260px; min-height:420px; }
.pane { border-right:1px solid #d5dae0; min-width:0; } .pane:last-child { border-right:0; }
.pane-h { font-size:12px; font-weight:600; padding:5px 10px; background:#f8f9fb; border-bottom:1px solid #d5dae0; }
.badge { font-weight:500; font-size:11px; background:#fff1cc; color:#8a5c00; border-radius:4px; padding:1px 6px; margin-left:6px; }
.edit { font:13px/1.55 ui-monospace,Consolas,monospace; background:#fafbfc; }
.ln { display:flex; } .ln .no { width:26px; text-align:right; padding-right:8px; color:#9aa3ad; } .ln .tx { white-space:pre; }
.ln.active { background:#dcfce7; box-shadow: inset 3px 0 0 var(--sim-active); } .ln.run { background:#f0fdf4; }
.st { width:16px; text-align:center; font:700 11px/1.55 ui-monospace,Consolas,monospace; } .st-s { color:#b4440a; } .st-i { text-decoration:underline; } .st-t { color:#1d5fd1; } .st-b { color:#7c3aed; }
.svgbox { position:relative; padding:10px; overflow:auto; } .svgbox svg { display:block; margin:0 auto; } .svgbox.small svg { width:100%; height:auto; }
.timer-cap { padding:0 10px 8px; } .timer { font:600 11px system-ui; background:#15803d; color:#fff; border-radius:4px; padding:1px 6px; }
.tags table { border-collapse:collapse; width:100%; font-size:13px; } .tags td, .tags th { padding:3px 8px; text-align:left; }
.grp { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#59626e; background:#f8f9fb; }
.sw { min-width:28px; font-weight:700; } .sw.on { background:#15803d; color:#fff; border-color:#15803d; }
.lamp { display:inline-block; width:11px; height:11px; border-radius:50%; background:#d5dae0; border:1px solid #b9c0c8; vertical-align:middle; } .lamp.on { background:#22c55e; border-color:#15803d; box-shadow:0 0 6px #22c55e; }
.bottom { border-top:1px solid #d5dae0; } .tabs { display:flex; gap:16px; padding:5px 12px; font-size:12.5px; background:#f8f9fb; border-bottom:1px solid #d5dae0; } .tabs .on { font-weight:700; border-bottom:2px solid #1a5fb4; }
.count { font-size:11px; background:#e6effa; border-radius:8px; padding:0 6px; }
.trace { margin:0; padding:6px 12px 8px 46px; font-size:13px; } .trace li { margin:2px 0; } .trace .s { color:#b4440a; font-weight:600; } .trace .t { color:#1d5fd1; font-weight:600; }
.pg { background:#fff; border:1px solid #d5dae0; border-radius:8px; overflow:hidden; max-width:1000px; }
.pg-bar { display:flex; gap:8px; align-items:center; padding:5px 10px; background:#f8f9fb; border-bottom:1px solid #d5dae0; }
.pg-body { display:grid; grid-template-columns:1fr 1fr; } .pg-code { font:13px/1.55 ui-monospace,Consolas,monospace; border-right:1px solid #d5dae0; }
.pg-sim { padding:6px 10px; border-top:1px solid #d5dae0; background:#f0fdf4; font-size:13px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.checks { border-collapse:collapse; background:#fff; max-width:1150px; } .checks td { border:1px solid #d5dae0; padding:6px 10px; vertical-align:top; font-size:13px; }
.checks pre { margin:0; font:12px/1.45 ui-monospace,Consolas,monospace; } .w { color:#8a5c00; font-weight:700; }
.ip-decl { font-weight:800; } .ip-stepkw, .ip-stepdef, .ip-target, .ip-ref { color:#b4440a; font-weight:700; } .ip-trans, .ip-label { color:#1d5fd1; font-weight:700; }
.ip-branch { color:#7c3aed; font-weight:700; } .ip-action { color:#15803d; font-weight:700; } .ip-time, .ip-reftime { color:#0e7490; font-weight:600; } .ip-value { color:#be185d; } .ip-op, .ip-comment { color:#6b7280; }
${activeCss(["mix"], ["level_ok"], ["mix.done"], {})}
@media (max-width: 1000px) { .cols3 { grid-template-columns:1fr; } .pane { border-right:0; border-bottom:1px solid #d5dae0; } .pg-body { grid-template-columns:1fr; } }
</style></head><body class="qsfc-light">
<h1>Phase 4e · Simulation (mockup)</h1>
<p class="lead">The chart runs like the PLC: each scan runs the active steps' actions, then fires the true transitions once; a step that ends gets a last scan that resets its <code>[:=]</code> outputs. Play runs in real time, Step runs one scan. Real diagram, highlighting and S/T column; values are static here.</p>
<ol class="choices">
  <li><b>Simulate</b> (button in the menu bar, or F5) switches the window to simulation: the editor is read-only (editing stops the simulation), the Tags panel becomes <b>Live tags</b>, and a <b>Trace</b> tab joins Problems.</li>
  <li><b>Inputs</b> are the tags the chart only reads: click to toggle a BOOL, type a number. <b>Outputs</b> show as lamps (with "stored" for set / S). Steps list their time.</li>
  <li><b>Diagram</b>: active steps filled green, the transitions after them green when true and red when false, a timer badge on an active step with a preset. The editor highlights the active step's line and its action lines; routine tabs show a dot when a routine has an active step.</li>
  <li><b>Minimal ST</b> (as chosen): expressions, <code>:=</code> / <code>[:=]</code>, IF / ELSIF / ELSE, the sugar, step members and the qualifiers N S R L D P. Anything else (TON, CASE, JSR into ladder…) is skipped with a note in the Trace.</li>
  <li><b>Help playgrounds</b> get a Run button: the same simulation, with the inputs as toggles under the code.</li>
  <li><b><code>-- else</code></b> as the last leg of a <code>select</code>: true when every other leg is false; exported as <code>NOT (c1 OR c2 …)</code>, drawn with its condition written out.</li>
  <li><b>Logic checks</b> (W700-W704) in Problems while you type, table below.</li>
</ol>
<h2>A · The window, simulating (scan 64: mix active)</h2>
${window1}
<h2>B · A Help playground with Run</h2>
${playground}
<h2>C · SFC logic checks (warnings in Problems)</h2>
<table class="checks">
${checks.map(([c, m, ex, fix]) => `<tr><td class="w">${c}</td><td>${m}<div class="muted">Fix: ${fix}</div></td><td><pre>${ex}</pre></td></tr>`).join("")}
</table>
</body></html>
`;
mkdirSync("docs/mockups/sim", { recursive: true });
writeFileSync("docs/mockups/sim/index.html", html);
console.log("wrote docs/mockups/sim/index.html");
