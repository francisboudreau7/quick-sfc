/**
 * Phase 2 look mockups: renders docs/mockups/demo.qsfc in both looks and writes
 *   docs/mockups/look-studio.svg, look-textbook.svg, look-textbook-numbers.svg
 *   docs/mockups/index.html   (one self-contained page, works when opened as a file)
 *
 * Run: npx tsx scripts/mockups.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compile, routineName } from "../src/compile.js";
import { formatDiagnostic, warning } from "../src/model/diagnostics.js";
import { escapeXml, renderSvg } from "../src/render/svg.js";

const dir = new URL("../docs/mockups/", import.meta.url);
const fileName = "demo.qsfc";
const source = readFileSync(new URL(fileName, dir), "utf8");
const result = compile(source);
if (!result.graph || !result.layout) {
  for (const d of result.diagnostics) console.error(formatDiagnostic(d, fileName));
  throw new Error("demo.qsfc does not compile");
}
const { graph, layout, tags, diagnostics } = result;

const studio = renderSvg(graph, layout, { look: "studio" });
const textbook = renderSvg(graph, layout, { look: "textbook" });
const numbered = renderSvg(graph, layout, { look: "textbook", numbering: "numbers" });
writeFileSync(new URL("look-studio.svg", dir), studio);
writeFileSync(new URL("look-textbook.svg", dir), textbook);
writeFileSync(new URL("look-textbook-numbers.svg", dir), numbered);

const esc = escapeXml;
const routine = routineName(result.chart, fileName);
const errors = diagnostics.filter((d) => d.severity === "error").length;
const warnings = diagnostics.filter((d) => d.severity === "warning").length;

// ---- tags table ----
const tagRows = tags
  .map((t) => {
    const lines = [...new Set(t.uses.map((u) => u.line))].sort((a, b) => a - b);
    const where = lines.map((l) => `<a href="#" class="line">L${l}</a>`).join(" ");
    return `<tr><td class="mono">${esc(t.name)}</td><td><span class="type type-${t.type.toLowerCase()}">${t.type}</span></td><td class="uses"><b>${t.uses.length}</b> ${where}</td></tr>`;
  })
  .join("\n");

// ---- problems ----
const problemItem = (text: string, severity: string, line: number, example: boolean): string =>
  `<li class="problem ${severity}"><span class="sev">${severity === "error" ? "✕" : "!"}</span>` +
  `<a href="#" class="line">L${line}</a><code>${esc(text)}</code>${example ? '<span class="badge">example</span>' : ""}</li>`;
let problems: string;
let problemCount: string;
if (diagnostics.length > 0) {
  problems = diagnostics.map((d) => problemItem(formatDiagnostic(d, fileName), d.severity, d.span.line, false)).join("\n");
  problemCount = `${diagnostics.length}`;
} else {
  const last = graph.steps[graph.steps.length - 1]!;
  const sample = warning("W300", last.node.span, `step \`${last.name}\` has no transition after it: the chart stops there`);
  problems =
    problemItem(formatDiagnostic(sample, fileName), "warning", sample.span.line, true) +
    `\n<li class="note">${esc(fileName)} itself has no problems; the line above only shows how a warning is listed.</li>`;
  problemCount = "0";
}

const branchCount = graph.branches.length;
const stripSvg = (s: string): string => s.trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>qSFC diagram looks</title>
<style>
:root{
  --bg:#f4f5f7;--surface:#ffffff;--surface-2:#f8f9fb;--border:#dde1e6;--text:#1d2228;--muted:#5d6672;
  --accent:#1a5fb4;--accent-soft:#e6effa;--warn:#9a6700;--warn-soft:#fff4d6;--err:#c62828;
  --toolbar:#eef0f3;--shadow:0 1px 2px rgba(16,24,40,.06),0 2px 8px rgba(16,24,40,.06);
  --radius:10px;--on-accent:#ffffff;color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not(.qsfc-light){
    --bg:#111418;--surface:#1c1f24;--surface-2:#20242a;--border:#30363d;--text:#e3e7eb;--muted:#9aa4af;
    --accent:#79b0ff;--accent-soft:#1d2d44;--warn:#e3b341;--warn-soft:#3a2f12;--err:#ff7b72;
    --toolbar:#23272e;--shadow:0 1px 2px rgba(0,0,0,.4);--on-accent:#0d1117;color-scheme:dark;
  }
}
:root.qsfc-dark{
  --bg:#111418;--surface:#1c1f24;--surface-2:#20242a;--border:#30363d;--text:#e3e7eb;--muted:#9aa4af;
  --accent:#79b0ff;--accent-soft:#1d2d44;--warn:#e3b341;--warn-soft:#3a2f12;--err:#ff7b72;
  --toolbar:#23272e;--shadow:0 1px 2px rgba(0,0,0,.4);--on-accent:#0d1117;color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;font-size:.86em}
header.page{display:flex;align-items:center;gap:16px;justify-content:space-between;padding:20px 24px;max-width:1600px;margin:0 auto;flex-wrap:wrap}
header.page h1{margin:0;font-size:1.35rem;letter-spacing:-.01em}
header.page p{margin:2px 0 0;color:var(--muted)}
.theme-toggle{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:7px 14px;font:inherit;font-size:.9rem;cursor:pointer;box-shadow:var(--shadow)}
.theme-toggle:hover{border-color:var(--accent)}
main{max-width:1600px;margin:0 auto;padding:0 24px 48px}
section{margin-top:28px}
section>h2{font-size:1.05rem;margin:0 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.looks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,600px),1fr));gap:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;min-width:0}
.card header{padding:14px 18px 10px;border-bottom:1px solid var(--border)}
.card h3{margin:0;font-size:1.05rem}
.card .caption{margin:2px 0 0;color:var(--muted);font-size:.9rem}
.figure{overflow:auto;padding:8px;background:var(--surface)}
.figure svg{display:block;margin:0 auto}
.card.wide{grid-column:1/-1}
/* ---- window mock ---- */
.app{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;display:grid;grid-template-rows:auto 1fr auto auto;min-height:760px}
.toolbar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--toolbar);border-bottom:1px solid var(--border);flex-wrap:wrap;position:relative}
.menu{position:relative}
.btn{border:1px solid transparent;background:transparent;color:var(--text);border-radius:6px;padding:5px 10px;font:inherit;font-size:.9rem;line-height:1.2;cursor:default}
.btn.open,.btn:hover{background:var(--surface);border-color:var(--border)}
.dropdown{position:absolute;top:calc(100% + 4px);left:0;z-index:5;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.18);padding:5px;min-width:240px}
.dropdown div{display:flex;justify-content:space-between;gap:24px;padding:7px 10px;border-radius:5px;font-size:.9rem}
.dropdown div:first-child{background:var(--accent-soft)}
.dropdown kbd{font:inherit;font-size:.8rem;color:var(--muted)}
.dropdown hr{border:0;border-top:1px solid var(--border);margin:4px 2px}
.sep{width:1px;align-self:stretch;background:var(--border);margin:2px 4px}
.group{display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden;background:var(--surface)}
.group .btn{border-radius:0;border:0;border-right:1px solid var(--border);padding:5px 10px}
.group .btn:last-child{border-right:0}
.group .btn.on{background:var(--accent);color:var(--on-accent)}
.zoom-val{min-width:58px;text-align:center;font-variant-numeric:tabular-nums}
.label{color:var(--muted);font-size:.85rem}
.filename{margin-left:auto;font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:6px}
.filename .dot{width:8px;height:8px;border-radius:50%;background:#2da44e}
.body{display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:0}
.canvas{overflow:auto;background:var(--surface-2);background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:18px 18px;padding:20px;min-height:420px;max-height:900px}
.canvas svg{display:block;margin:0 auto;box-shadow:var(--shadow);border-radius:6px}
aside.tags{border-left:1px solid var(--border);background:var(--surface);overflow:auto;max-height:900px}
.panel-title{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-weight:600;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface)}
.count{background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:0 8px;font-size:.78rem;letter-spacing:0}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th{text-align:left;font-weight:600;color:var(--muted);font-size:.78rem;padding:7px 14px;border-bottom:1px solid var(--border)}
td{padding:6px 14px;border-bottom:1px solid var(--border);vertical-align:top}
tr:hover td{background:var(--surface-2)}
.type{font-family:ui-monospace,Consolas,monospace;font-size:.75rem;padding:1px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent)}
.type-dint,.type-real{background:var(--warn-soft);color:var(--warn)}
.uses{white-space:nowrap}
.uses b{display:inline-block;min-width:1.2em}
a.line{color:var(--accent);text-decoration:none;font-family:ui-monospace,Consolas,monospace;font-size:.8rem;margin-right:2px}
a.line:hover{text-decoration:underline}
.problems{border-top:1px solid var(--border)}
.problems ul{list-style:none;margin:0;padding:4px 0;max-height:160px;overflow:auto}
.problem{display:flex;align-items:baseline;gap:10px;padding:5px 14px;font-size:.88rem}
.problem:hover{background:var(--surface-2)}
.problem code{white-space:pre-wrap;word-break:break-word}
.sev{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;font-size:.7rem;font-weight:700;flex:none;transform:translateY(2px)}
.warning .sev{background:var(--warn-soft);color:var(--warn)}
.error .sev{background:#fde8e8;color:var(--err)}
.badge{font-size:.72rem;border:1px solid var(--border);border-radius:999px;padding:0 7px;color:var(--muted)}
.note{padding:2px 14px 8px 40px;color:var(--muted);font-size:.82rem}
.status{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:5px 12px;font-size:.8rem;color:var(--muted);background:var(--toolbar);border-top:1px solid var(--border)}
.status .ok{color:#2da44e;font-weight:600}
.status .right{margin-left:auto}
.mock-note{color:var(--muted);font-size:.88rem;margin:-4px 0 12px}
@media (max-width: 900px){
  .body{grid-template-columns:1fr}
  aside.tags{border-left:0;border-top:1px solid var(--border);max-height:none}
  .canvas{max-height:620px}
}
@media (max-width: 560px){
  header.page,main{padding-left:12px;padding-right:12px}
  .toolbar{gap:6px}
  .toolbar .label{display:none}
  .filename{margin-left:0;width:100%}
  .dropdown{min-width:210px}
  .status .right{margin-left:0}
}
</style>
</head>
<body>
<header class="page">
  <div>
    <h1>qSFC v2 — diagram looks</h1>
    <p>Mockups for Phase 2. The same chart (<span class="mono">${esc(fileName)}</span>) drawn from the same layout in two looks. Pick one.</p>
  </div>
  <button class="theme-toggle" id="theme" type="button" aria-label="Toggle light or dark">◐ Light / dark</button>
</header>
<main>
<section>
  <h2>Looks</h2>
  <div class="looks">
    <article class="card">
      <header><h3>Look A — Studio 5000 style</h3><p class="caption">Modeled on the Rockwell Studio 5000 SFC editor: step boxes with operands, N action boxes, named transitions.</p></header>
      <div class="figure">${stripSvg(studio)}</div>
    </article>
    <article class="card">
      <header><h3>Look B — textbook IEC/GRAFCET style</h3><p class="caption">Modeled on IEC 60848 GRAFCET and IEC 61131-3 course diagrams: square steps, receptivities beside thick bars.</p></header>
      <div class="figure">${stripSvg(textbook)}</div>
    </article>
    <article class="card">
      <header><h3>Look B with step numbers</h3><p class="caption">The textbook look with GRAFCET numbering: steps 1, 2, 3… in file order, the qSFC name beside each square.</p></header>
      <div class="figure">${stripSvg(numbered)}</div>
    </article>
  </div>
</section>

<section>
  <h2>Window layout (Phase 2)</h2>
  <p class="mock-note">Static mock, nothing is clickable. Tags, counts and problems are the real data of ${esc(fileName)}.</p>
  <div class="app" aria-label="Window mock">
    <div class="toolbar">
      <div class="menu">
        <span class="btn open">File ▾</span>
        <div class="dropdown" role="menu">
          <div>Open .qsfc…<kbd>Ctrl+O</kbd></div>
          <hr>
          <div>Export L5X…<kbd>Ctrl+E</kbd></div>
          <div>Export diagram as SVG…<kbd></kbd></div>
        </div>
      </div>
      <span class="sep"></span>
      <span class="label">Zoom</span>
      <span class="group"><span class="btn" title="Zoom out">−</span><span class="btn zoom-val">100 %</span><span class="btn" title="Zoom in">+</span><span class="btn">Fit</span></span>
      <span class="sep"></span>
      <span class="label">Look</span>
      <span class="group"><span class="btn on">A</span><span class="btn">B</span></span>
      <span class="filename"><span class="dot"></span>${esc(fileName)} <span class="label">· routine ${esc(routine)}</span></span>
    </div>
    <div class="body">
      <div class="canvas">${stripSvg(studio)}</div>
      <aside class="tags">
        <div class="panel-title">Tags <span class="count">${tags.length}</span></div>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Uses</th></tr></thead>
          <tbody>
${tagRows}
          </tbody>
        </table>
      </aside>
    </div>
    <div class="problems">
      <div class="panel-title">Problems <span class="count">${problemCount}</span></div>
      <ul>
${problems}
      </ul>
    </div>
    <div class="status">
      <span>${esc(fileName)}</span>
      <span>${graph.steps.length} steps</span>
      <span>${graph.transitions.length} transitions</span>
      <span>${branchCount} branches</span>
      <span class="ok">${errors} errors</span>
      <span>${warnings} warnings</span>
      <span class="right">Studio 5000 L5X · ready</span>
    </div>
  </div>
</section>
</main>
<script>
(function () {
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function isDark() {
    if (root.classList.contains("qsfc-dark")) return true;
    if (root.classList.contains("qsfc-light")) return false;
    return !!(media && media.matches);
  }
  document.getElementById("theme").addEventListener("click", function () {
    var dark = !isDark();
    root.classList.toggle("qsfc-dark", dark);
    root.classList.toggle("qsfc-light", !dark);
  });
})();
</script>
</body>
</html>
`;
writeFileSync(new URL("index.html", dir), html);
console.log("wrote docs/mockups/look-studio.svg, look-textbook.svg, look-textbook-numbers.svg, index.html");
