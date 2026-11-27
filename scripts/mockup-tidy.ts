/**
 * Builds docs/mockups/tidy/index.html: the Tidy dialog mockup (Phase 4a), with the real
 * legacy/tests/MainProgram.L5X drawn from its Studio coordinates before and after Tidy.
 *   npx tsx scripts/mockup-tidy.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tidyL5X } from "../src/tidy/index.js";
import { renderStudioSketch } from "../src/render/sketch.js";

const before = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
const result = tidyL5X(before);
const after = result.text;

const sketch = (xml: string): string => renderStudioSketch(xml, result.routines[0]!.name);

const r = result.routines[0]!;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidy mockup</title>
<style>
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:#e9ecf0; color:#1d2228; }
h1 { font-size:18px; margin:0 0 4px; } .lead { color:#59626e; margin:0 0 12px; max-width:900px; }
.dialog { background:#fff; border:1px solid #b9c0c8; border-radius:10px; box-shadow:0 8px 24px rgba(16,24,40,.18); max-width:1100px; }
.head { padding:12px 16px; border-bottom:1px solid #d5dae0; display:flex; gap:12px; align-items:baseline; }
.head h2 { margin:0; font-size:16px; } .head .file { color:#59626e; font-family:ui-monospace,Consolas,monospace; font-size:13px; }
.routines { padding:8px 16px; border-bottom:1px solid #d5dae0; }
.routines table { border-collapse:collapse; width:100%; font-size:13px; }
.routines td { padding:4px 8px; border-bottom:1px solid #eef0f3; } .ok { color:#1a7f37; } .skip { color:#8a5c00; }
.panes { display:grid; grid-template-columns:1fr 1fr; gap:0; }
.pane { padding:10px 16px; overflow:auto; max-height:560px; } .pane + .pane { border-left:1px solid #d5dae0; }
.pane h3 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#59626e; margin:0 0 6px; }
.pane svg { background-color:#fff; background-image:radial-gradient(#d9dde3 1px, transparent 1px); background-size:12px 12px; }
.foot { padding:10px 16px; border-top:1px solid #d5dae0; display:flex; gap:8px; justify-content:flex-end; align-items:center; }
.foot .note { margin-right:auto; color:#59626e; font-size:12.5px; }
button { font:inherit; border-radius:6px; padding:6px 12px; border:1px solid #b9c0c8; background:#fff; }
button.primary { background:#1a5fb4; color:#fff; border-color:#1a5fb4; }
ul { margin:10px 0 0; padding-left:18px; max-width:1100px; }
</style></head><body>
<h1>Tidy an L5X (Phase 4a)</h1>
<p class="lead">File → <b>Tidy an L5X…</b> opens a Studio export and shows each SFC routine before and after. Both sides are drawn from the Studio coordinates in the file (real data: <code>legacy/tests/MainProgram.L5X</code>, drawn by hand in Studio), the way Studio places the boxes, not with the qSFC diagram.</p>
<div class="dialog">
  <div class="head"><h2>Tidy an L5X</h2><span class="file">MainProgram.L5X · program MainProgram</span></div>
  <div class="routines"><table>
    <tr><td><input type="checkbox" checked></td><td><b>${r.name}</b> (SFC)</td><td class="ok">tidied: ${r.moved} elements moved, ${r.hidden} wires hidden</td><td>links, actions, conditions and tags unchanged</td></tr>
    <tr><td><input type="checkbox" disabled></td><td><b>Fault_Seq</b> (SFC, example)</td><td class="skip">left as it is: a jump enters a parallel branch</td><td></td></tr>
  </table></div>
  <div class="panes">
    <div class="pane"><h3>Before</h3>${sketch(before)}</div>
    <div class="pane"><h3>After</h3>${sketch(after)}</div>
  </div>
  <div class="foot"><span class="note">Only positions change. Import the saved file into Studio: right-click the program's task → Import Program, or replace the routine.</span><button>Cancel</button><button class="primary">Save tidied L5X…</button></div>
</div>
<ul>
  <li>The routine list ticks every tidied routine; untick one to keep it as it was. Skipped routines say why, in one sentence.</li>
  <li>Before/After use the same simple drawing, so the comparison is fair. Hidden wires are dashed.</li>
  <li>The CLI does the same: <code>qsfc tidy MainProgram.L5X -o MainProgram_tidy.L5X</code>.</li>
</ul>
</body></html>`;

mkdirSync("docs/mockups/tidy", { recursive: true });
writeFileSync("docs/mockups/tidy/index.html", html, "utf8");
console.log("docs/mockups/tidy/index.html");
