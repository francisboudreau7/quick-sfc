/**
 * Builds docs/mockups/routines/index.html: the routine tabs mockup (Phase 3.5), with real
 * diagrams of testpack/tp08_routines.qsfc.   npx tsx scripts/mockup-routines.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { renderSvg } from "../src/render/svg.js";

const source = readFileSync("testpack/tp08_routines.qsfc", "utf8");
const r = compile(source, { fileName: "tp08_routines.qsfc" });
const fill = r.routines.find((x) => x.name === "fill_seq")!;
const svg = renderSvg(fill.graph!, fill.layout!, { look: "textbook" });
const lines = source.split(/\r?\n/);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const editor = (cursor: number) =>
  lines
    .map((l, i) => {
      const n = i + 1;
      const head = /^(program|sfc|st)\b/.test(l);
      return `<div class="ln${n === cursor ? " cur" : ""}${head ? " head" : ""}"><span class="no">${n}</span>${esc(l) || "&nbsp;"}</div>`;
    })
    .join("");

const tabs = (active: string) =>
  `<div class="tabs" role="tablist">${r.routines
    .map((x, i) => {
      const kind = x.kind === "sfc" ? "SFC" : "ST";
      return `<button class="tab${x.name === active ? " on" : ""}" role="tab"><span class="kind ${x.kind}">${kind}</span>${x.name}${i === 0 ? '<span class="main" title="Main routine">main</span>' : ""}</button>`;
    })
    .join("")}</div>`;

const main = r.routines[0]!;
const kindOf = (n: string) => r.routines.find((x) => x.name === n)!.kind.toUpperCase();
const chip = (n: string) => `<a class="chip"><span class="kind ${kindOf(n).toLowerCase()}">${kindOf(n)}</span>${n}</a>`;
const stCard = `
<div class="st-card">
  <div class="st-title"><span class="kind st">ST</span> <b>main</b> <span class="badge">main routine</span></div>
  <p class="muted">Studio runs the main routine every scan. ${main.node.kind === "st" ? main.node.body.length : 0} lines of ST.</p>
  <h3>Calls</h3>
  <div class="chips">${main.calls.map(chip).join("")}</div>
  <h3>Called by</h3>
  <p class="muted">nothing (it's the main routine)</p>
  <h3>Call tree</h3>
  <pre class="tree">main
├─ fill_seq   SFC
│  └─ count_cycles   ST   (from step count)
├─ mixer      SFC
└─ alarms     ST</pre>
</div>`;

const frame = (title: string, cursor: number, active: string, diagram: string, note: string) => `
<figure>
  <figcaption>${title}</figcaption>
  <div class="app">
    <div class="toolbar"><b>q<span>SFC</span></b> File ▾ View ▾ Help ▾ <span class="sp"></span> − 100 % + Fit <span class="sp"></span> Tags <span class="grow"></span> tp08_routines.qsfc <button class="primary">Export L5X</button></div>
    <div class="body">
      <div class="editor">${editor(cursor)}</div>
      <div class="canvas">${tabs(active)}<div class="stage">${diagram}</div></div>
    </div>
    <div class="status">tp08_routines.qsfc · 5 routines (2 SFC, 3 ST) · 0 problems · Ln ${cursor} · <b>${active}</b></div>
  </div>
  <p class="note">${note}</p>
</figure>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Routine tabs mockup</title>
<style>
body { margin: 0; padding: 16px; font: 14px/1.45 system-ui, sans-serif; background: #f4f5f7; color: #1d2228; }
h1 { font-size: 18px; margin: 0 0 4px; } .lead { margin: 0 0 12px; color: #59626e; max-width: 900px; }
figure { margin: 0 0 24px; } figcaption { font-weight: 600; margin-bottom: 6px; }
.app { border: 1px solid #b9c0c8; border-radius: 8px; overflow: hidden; background: #fff; max-width: 1180px; box-shadow: 0 2px 8px rgba(16,24,40,.08); }
.toolbar { display: flex; gap: 10px; align-items: center; padding: 6px 10px; background: #eef0f3; border-bottom: 1px solid #d5dae0; font-size: 13px; color: #59626e; }
.toolbar b { color: #1d2228; } .toolbar b span { color: #1a5fb4; } .sp { width: 1px; height: 16px; background: #d5dae0; } .grow { flex: 1; }
button.primary { background: #1a5fb4; color: #fff; border: 0; border-radius: 5px; padding: 4px 10px; font: inherit; }
.body { display: grid; grid-template-columns: minmax(0, 42fr) minmax(0, 58fr); height: 560px; }
.editor { border-right: 1px solid #d5dae0; overflow: auto; font: 12.5px/1.55 ui-monospace, Consolas, monospace; padding: 6px 0; white-space: pre; }
.ln { padding: 0 8px 0 0; } .ln .no { display: inline-block; width: 30px; text-align: right; margin-right: 10px; color: #9aa3ad; }
.ln.cur { background: rgba(26,95,180,.08); } .ln.head { color: #8250df; font-weight: 600; border-top: 1px dashed #d5dae0; }
.canvas { display: flex; flex-direction: column; min-width: 0; background-color: #fff; background-image: radial-gradient(#d9dde3 1px, transparent 1px); background-size: 16px 16px; }
.tabs { display: flex; gap: 2px; padding: 6px 8px 0; background: #eef0f3; border-bottom: 1px solid #d5dae0; overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; padding: 5px 10px; background: transparent; font: 13px system-ui; color: #59626e; white-space: nowrap; }
.tab.on { background: #fff; border-color: #d5dae0; color: #1d2228; font-weight: 600; margin-bottom: -1px; }
.kind { font: 700 10px system-ui; border-radius: 3px; padding: 1px 4px; } .kind.sfc { background: #e6effa; color: #1a5fb4; } .kind.st { background: #efe7fb; color: #6639ba; }
.main { font-size: 10px; border: 1px solid #b9c0c8; border-radius: 8px; padding: 0 5px; color: #59626e; font-weight: 400; }
.stage { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 16px; }
.stage svg { max-width: 100%; height: auto; }
.status { padding: 4px 10px; font-size: 12px; color: #59626e; border-top: 1px solid #d5dae0; background: #eef0f3; }
.st-card { background: #fff; border: 1px solid #d5dae0; border-radius: 8px; padding: 14px 18px; width: min(460px, 100%); box-shadow: 0 1px 2px rgba(16,24,40,.06); }
.st-title { font-size: 15px; display: flex; gap: 8px; align-items: center; } .badge { font-size: 11px; background: #eef0f3; border-radius: 8px; padding: 1px 7px; color: #59626e; }
.st-card h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #59626e; margin: 14px 0 6px; }
.muted { color: #59626e; margin: 4px 0; } .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid #b9c0c8; border-radius: 14px; padding: 2px 10px 2px 4px; color: #1a5fb4; cursor: pointer; }
.tree { margin: 0; font: 12.5px/1.5 ui-monospace, Consolas, monospace; background: #f4f5f7; border-radius: 6px; padding: 8px 10px; }
.note { max-width: 1180px; color: #1d2228; margin: 6px 0 0; }
ul { margin: 6px 0 0; padding-left: 18px; }
</style></head><body>
<h1>Routine tabs (Phase 3.5)</h1>
<p class="lead">The file is <code>testpack/tp08_routines.qsfc</code>: 5 routines. The diagrams are drawn by the real renderer. One tab per routine, in file order; the first one is the main routine.</p>
${frame("A. Cursor in an SFC routine: its diagram", 17, "fill_seq", svg,
  `Moving the cursor into another routine switches the tab (the diagram follows the cursor). Clicking a tab shows that routine and moves the cursor to its header line. Tags stay in the Tags sidebar (not shown), for the whole program.`)}
${frame("B. Cursor in an ST routine: a call summary card", 9, "main", stCard,
  `<ul><li>ST routines have no diagram, so the tab shows what the routine calls and who calls it. Clicking a chip opens that routine's tab and moves the cursor there.</li>
  <li>The call tree is drawn from the main routine down, so you can see which routines run and from where.</li>
  <li>In the editor, <code>call fill_seq;</code> gets Ctrl+click to jump to <code>sfc fill_seq</code>, and autocomplete lists routine names after <code>call</code>.</li>
  <li>A file with a single routine looks exactly like today: no tab bar.</li></ul>`)}
</body></html>`;

mkdirSync("docs/mockups/routines", { recursive: true });
writeFileSync("docs/mockups/routines/index.html", html, "utf8");
console.log("docs/mockups/routines/index.html");
