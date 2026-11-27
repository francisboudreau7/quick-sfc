/**
 * Pure helpers of the Help view (no DOM): inline text, the code of an example as highlighted HTML,
 * and the printable pages of Learning qSFC and the Reference ("Print / open as a page").
 * Unit-tested in test/app/help.test.ts.
 */
import { compile, type CompileResult } from "../../src/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { previewHtml } from "../importl5x.js";
import { LESSONS, REFERENCE, REFERENCE_GROUPS, type Lesson, type RefEntry } from "./content.js";
import { findProblem, PROBLEM_GROUPS } from "./problems.js";

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Short help text as HTML: `code` between backticks; everything else escaped. */
export function inline(text: string): string {
  return text
    .split("`")
    .map((part, i) => (i % 2 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
    .join("");
}

/** An example's code, highlighted like the editor. */
export function codeHtml(source: string): string {
  return `<pre class="help-code">${previewHtml(source)}</pre>`;
}

/** The file name examples compile under (a header-less routine is named after it). */
export const EXAMPLE_FILE = "example.qsfc";

export function compileExample(source: string): CompileResult {
  return compile(source, { fileName: EXAMPLE_FILE });
}

/** Every routine's diagram (textbook look), with the routine name when there are several. */
export function diagramsHtml(r: CompileResult, svg: (r: CompileResult, i: number) => string = staticSvg): string {
  const charts = r.routines.map((x, i) => ({ x, i })).filter(({ x }) => x.graph && x.layout);
  if (!charts.length) return "";
  return charts
    .map(({ x, i }) => `${charts.length > 1 || r.routines.length > 1 ? `<div class="help-dia-name">${escapeHtml(x.name)}</div>` : ""}${svg(r, i)}`)
    .join("");
}

function staticSvg(r: CompileResult, i: number): string {
  const x = r.routines[i]!;
  return renderSvg(x.graph!, x.layout!, { look: "textbook" });
}

function lessonBody(l: Lesson, n: number): string {
  const r = compileExample(l.example);
  return [
    `<h2>${n}. ${escapeHtml(l.title)}</h2>`,
    `<p class="lead">${inline(l.lead)}</p>`,
    `<div class="pair">${codeHtml(l.example)}<div class="dia">${diagramsHtml(r)}</div></div>`,
    `<table class="summary">${l.summary.map(([c, t]) => `<tr><td><code>${escapeHtml(c)}</code></td><td>${inline(t)}</td></tr>`).join("")}</table>`,
    `<h3>Try this</h3><ol>${l.tries.map((t) => `<li>${inline(t.prompt)}${t.solution ? `<details><summary>A solution</summary>${codeHtml(t.solution)}</details>` : ""}</li>`).join("")}</ol>`,
  ].join("\n");
}

function entryBody(e: RefEntry): string {
  const parts = [`<h2>${escapeHtml(e.title)}</h2>`, codeHtml(e.syntax)];
  if (e.example) parts.push(`<div class="pair">${codeHtml(e.example)}<div class="dia">${diagramsHtml(compileExample(e.example))}</div></div>`);
  parts.push(`<ul>${e.rules.map((r) => `<li>${inline(r)}</li>`).join("")}</ul>`);
  if (e.problems.length) {
    parts.push(
      `<table class="codes">${e.problems
        .map((c) => {
          const p = findProblem(c);
          return `<tr><td><b>${c}</b></td><td>${p ? inline(p.what) : ""}</td></tr>`;
        })
        .join("")}</table>`,
    );
  }
  return parts.join("\n");
}

const PAGE_STYLE = `
body { margin:0; padding:20px 24px; font:14px/1.45 system-ui,"Segoe UI",sans-serif; color:#1d2228; background:#fff; max-width:1000px; }
h1 { font-size:22px; margin:0 0 12px; } h2 { font-size:18px; margin:26px 0 4px; border-top:1px solid #d5dae0; padding-top:14px; }
h3 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#59626e; margin:12px 0 4px; } .group { color:#59626e; margin-top:28px; font-size:13px; text-transform:uppercase; letter-spacing:.06em; }
.lead { margin:0 0 8px; } code { font-family:ui-monospace,Consolas,monospace; font-size:12.5px; background:#f4f5f7; padding:1px 4px; border-radius:3px; }
pre.help-code { margin:4px 0; font:12.5px/1.5 ui-monospace,Consolas,monospace; background:#f4f5f7; padding:8px 10px; border-radius:6px; white-space:pre; overflow-x:auto; }
.ip-decl { font-weight:800; } .ip-declname { font-weight:700; } .ip-stepkw, .ip-stepdef, .ip-target, .ip-ref { color:#b4440a; font-weight:700; } .ip-ref { font-weight:600; }
.ip-trans, .ip-label { color:#1d5fd1; font-weight:700; } .ip-branch { color:#7c3aed; font-weight:700; } .ip-action { color:#15803d; font-weight:700; }
.ip-time, .ip-reftime { color:#0e7490; font-weight:600; } .ip-value { color:#be185d; } .ip-logic, .ip-stctl { font-weight:700; } .ip-func { font-style:italic; }
.ip-type, .ip-address, .ip-comment, .ip-op { color:#6b7280; } .ip-comment { font-style:italic; }
.pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; align-items:start; break-inside:avoid; }
.dia svg { max-width:100%; height:auto; } .help-dia-name { font-weight:600; font-size:12px; margin-top:6px; }
table { border-collapse:collapse; } td { padding:2px 12px 2px 0; vertical-align:top; } details summary { color:#1a5fb4; cursor:pointer; }
@media print { details { display:block; } details > summary { display:none; } h2 { break-before:auto; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

/** Learning qSFC as one printable page. */
export function learningPage(): string {
  return page("Learning qSFC", LESSONS.map((l, i) => lessonBody(l, i + 1)).join("\n"));
}

/** The Reference as one printable page, then every problem code. */
export function referencePage(): string {
  const groups = REFERENCE_GROUPS.map((g) => `<div class="group">${g}</div>${REFERENCE.filter((e) => e.group === g).map(entryBody).join("\n")}`);
  const problems = PROBLEM_GROUPS.map(
    (g) => `<h3>${escapeHtml(g.title)}</h3><table class="codes">${g.items.map((p) => `<tr><td><b>${p.code}</b></td><td>${inline(p.what)}</td><td>${inline(p.fix)}</td></tr>`).join("")}</table>`,
  );
  return page("qSFC Reference", `${groups.join("\n")}<h2>Problems</h2>${problems.join("\n")}`);
}
