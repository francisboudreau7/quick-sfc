/**
 * Builds docs/mockups/import/index.html: the "Open an L5X" dialog mockup (Phase 4d), with the
 * real legacy/tests/MainProgram.L5X (drawn by hand in Studio) and what the import makes of it.
 *   npx tsx scripts/mockup-import.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { importL5X } from "../src/import/index.js";
import { renderStudioSketch } from "../src/render/sketch.js";

const xml = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
const r = importL5X(xml);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code = r.source
  .split("\n")
  .map((l) => {
    const e = esc(l);
    if (/^\s*\/\//.test(l)) return `<span class="c">${e}</span>`;
    return e
      .replace(/^(\s*)(program|tag|io|end|sfc|st|init|step|select|parallel)\b/, '$1<span class="k">$2</span>')
      .replace(/^(\s*)(--)/, '$1<span class="k">$2</span>')
      .replace(/(-&gt;)/, '<span class="k">$1</span>')
      .replace(/(\/\/.*)$/, '<span class="c">$1</span>');
  })
  .join("\n");
const warnings = r.notes.filter((n) => n.level === "warning");
const infos = r.notes.filter((n) => n.level === "info");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open an L5X mockup</title>
<style>
body { margin:0; padding:16px; font:14px/1.45 system-ui,sans-serif; background:#e9ecf0; color:#1d2228; }
h1 { font-size:18px; margin:0 0 4px; } .lead { color:#59626e; margin:0 0 12px; max-width:960px; }
.dialog { background:#fff; border:1px solid #b9c0c8; border-radius:10px; box-shadow:0 8px 24px rgba(16,24,40,.18); max-width:1180px; }
.head { padding:12px 16px; border-bottom:1px solid #d5dae0; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
.head h2 { margin:0; font-size:16px; } .head .file { color:#59626e; font-family:ui-monospace,Consolas,monospace; font-size:13px; }
.head select { margin-left:auto; font:inherit; padding:3px 6px; }
.routines { padding:8px 16px; border-bottom:1px solid #d5dae0; font-size:13px; }
.routines td { padding:3px 8px 3px 0; } .ok { color:#1a7f37; } .skip { color:#8a5c00; }
.panes { display:grid; grid-template-columns:1fr 1fr; }
.pane { padding:10px 16px; overflow:auto; max-height:520px; } .pane + .pane { border-left:1px solid #d5dae0; }
.pane h3 { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#59626e; margin:0 0 6px; }
.pane svg { background-color:#fff; background-image:radial-gradient(#d9dde3 1px, transparent 1px); background-size:12px 12px; max-width:100%; height:auto; }
pre { margin:0; font:12.5px/1.5 ui-monospace,Consolas,monospace; white-space:pre; }
.k { color:#8250df; font-weight:600; } .c { color:#6e7781; }
.notes { padding:10px 16px; border-top:1px solid #d5dae0; font-size:13px; }
.notes ul { margin:4px 0 0; padding-left:0; list-style:none; } .notes li { padding:2px 0 2px 22px; position:relative; }
.notes li::before { position:absolute; left:0; top:2px; } .notes li.w::before { content:"⚠"; color:#9a6700; } .notes li.i::before { content:"ℹ"; color:#1a5fb4; }
.foot { padding:10px 16px; border-top:1px solid #d5dae0; display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap:wrap; }
.foot .note { margin-right:auto; color:#59626e; font-size:12.5px; }
button { font:inherit; border-radius:6px; padding:6px 12px; border:1px solid #b9c0c8; background:#fff; }
button.primary { background:#1a5fb4; color:#fff; border-color:#1a5fb4; }
ul.after { margin:10px 0 0; padding-left:18px; max-width:1100px; }
@media (max-width: 760px) { .panes { grid-template-columns:1fr; } .pane + .pane { border-left:0; border-top:1px solid #d5dae0; } }
</style></head><body>
<h1>Open an L5X (Phase 4d)</h1>
<p class="lead">File → <b>Open an L5X…</b> (or drop a .L5X on the window) reads a Studio export and turns one Program into qSFC. Real data: <code>legacy/tests/MainProgram.L5X</code>, drawn by hand in Studio. Left: the chart as Studio places it. Right: the .qsfc text the editor will get.</p>
<div class="dialog">
  <div class="head"><h2>Open an L5X</h2><span class="file">MainProgram.L5X</span>
    <select aria-label="Program"><option>Program: ${esc(r.program)}</option></select></div>
  <div class="routines"><table>
    ${r.routines.map((x) => `<tr><td>${esc(x.name)} (${x.type})</td><td class="${x.imported ? "ok" : "skip"}">${x.imported ? "imported" : `not imported: ${esc(x.reason ?? "")}`}</td></tr>`).join("")}
    <tr><td>Fault_Seq (RLL, example)</td><td class="skip">not imported: ladder routines come with Phase 5</td></tr>
  </table></div>
  <div class="panes">
    <div class="pane"><h3>In Studio</h3>${renderStudioSketch(xml, r.routines[0]!.name)}</div>
    <div class="pane"><h3>qSFC (${r.errors ? `${r.errors} error(s)` : "no errors"})</h3><pre>${code}</pre></div>
  </div>
  <div class="notes"><b>Not kept or changed (${warnings.length})</b>, also written at the top of the file:
    <ul>${warnings.map((n) => `<li class="w">${esc(n.text)}</li>`).join("")}${infos.map((n) => `<li class="i">${esc(n.text)}</li>`).join("")}</ul></div>
  <div class="foot"><span class="note">Opens as a new file, <b>MainProgram.qsfc</b> (nothing is saved yet). Export it again with File → Export L5X.</span><button>Cancel</button><button class="primary">Open in the editor</button></div>
</div>
<ul class="after">
  <li>Several programs in the file (a whole-controller export): the Program list at the top picks one.</li>
  <li>If the editor has unsaved changes, the usual "Discard changes?" question comes first.</li>
  <li>The CLI does the same: <code>qsfc import MainProgram.L5X -o MainProgram.qsfc [--program NAME]</code>.</li>
</ul>
</body></html>`;

mkdirSync("docs/mockups/import", { recursive: true });
writeFileSync("docs/mockups/import/index.html", html, "utf8");
console.log("docs/mockups/import/index.html");
