/**
 * Print / PDF view (Phase 4c) without the DOM: what goes on the printed pages (title block,
 * then for each routine its diagram, tag table and code) and its HTML. app/main.ts puts the
 * HTML in a print-only element and calls window.print(). Unit-tested in test/app.
 */
import type { CompiledRoutine } from "../src/compile.js";
import type { ProgramNode } from "../src/model/ast.js";
import type { TagInfo } from "../src/model/graph.js";
import { escapeXml } from "../src/render/svg.js";
import { programName, routineAtLine } from "./routines.js";

export interface PrintOptions {
  diagram: boolean;
  tags: boolean;
  code: boolean;
}

export const DEFAULT_PRINT: Readonly<PrintOptions> = { diagram: true, tags: true, code: true };

export interface PrintTagRow {
  name: string;
  type: string;
  address: string;
  description: string;
}

export interface PrintRoutine {
  name: string;
  kind: "sfc" | "st";
  /** The diagram's SVG (SFC routines with a diagram, when diagrams are printed). */
  svg?: string;
  /** Why there is no diagram (an SFC routine whose chart has errors). */
  noDiagram?: string;
  tags: PrintTagRow[];
  /** Source lines with their numbers. */
  code: Array<{ n: number; text: string }>;
}

export interface PrintModel {
  title: string;
  course?: string;
  author?: string;
  /** YYYY-MM-DD, the day of printing. */
  date: string;
  /** "program tank" */
  program: string;
  routines: PrintRoutine[];
  include: PrintOptions;
}

export interface PrintInput {
  program: Pick<ProgramNode, "header" | "title" | "meta">;
  routines: ReadonlyArray<Pick<CompiledRoutine, "name" | "kind" | "lines">>;
  tags: readonly TagInfo[];
  source: string;
  date: Date;
  include: PrintOptions;
  /** The diagram SVG of routine `i`, or undefined (ST routine, or no valid diagram). */
  diagram(i: number): string | undefined;
}

/** Local date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildPrintModel(input: PrintInput): PrintModel {
  const { program, routines, include } = input;
  const name = programName(program, routines);
  const lines = input.source.split(/\r?\n/);
  const model: PrintModel = {
    title: program.title ?? (program.header?.text || routines[0]?.name || "qSFC chart"),
    date: isoDate(input.date),
    program: `program ${name}`,
    routines: [],
    include: { ...include },
  };
  if (program.meta?.course) model.course = program.meta.course;
  if (program.meta?.author) model.author = program.meta.author;

  const byRoutine = routines.map(() => [] as TagInfo[]);
  for (const t of input.tags) {
    const at = new Set(t.uses.map((u) => routineAtLine(routines, u.line)));
    if (at.size === 0) at.add(0); // declared only: with the main routine
    for (const i of at) byRoutine[i]?.push(t);
  }

  routines.forEach((r, i) => {
    const pr: PrintRoutine = { name: r.name, kind: r.kind, tags: [], code: [] };
    if (include.diagram && r.kind === "sfc") {
      const svg = input.diagram(i);
      if (svg) pr.svg = svg;
      else pr.noDiagram = "No diagram: the chart has errors.";
    }
    if (include.tags) {
      pr.tags = [...byRoutine[i]!]
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map((t) => ({ name: t.name, type: t.type, address: t.address ?? "", description: t.description ?? "" }));
    }
    if (include.code) {
      // The lines before the first routine (program, course, io…) print with the first one.
      const from = i === 0 ? 1 : r.lines.from;
      let to = Math.min(r.lines.to, lines.length);
      while (to >= from && lines[to - 1]!.trim() === "") to--;
      for (let n = from; n <= to; n++) pr.code.push({ n, text: lines[n - 1]! });
    }
    model.routines.push(pr);
  });
  return model;
}

const esc = escapeXml;

/** The print layout's HTML (inside the print-only element). */
export function printHtml(m: PrintModel): string {
  const meta = [m.course, m.author, m.date].filter((x): x is string => !!x).map(esc).join(" · ");
  const out: string[] = [];
  out.push(
    `<header class="pv-title"><div class="pv-title-main"><h1>${esc(m.title)}</h1><p class="pv-meta">${meta}</p></div>` +
      `<div class="pv-title-side"><p>${esc(m.program)}</p><p>${m.routines.length === 1 ? "1 routine" : `${m.routines.length} routines`}</p></div></header>`,
  );
  const several = m.routines.length > 1;
  for (const r of m.routines) {
    const parts: string[] = [];
    parts.push(`<h2 class="pv-routine-title">${r.kind.toUpperCase()} routine ${esc(r.name)}</h2>`);
    if (m.include.diagram) {
      if (r.svg) parts.push(`<figure class="pv-diagram">${r.svg}</figure>`);
      else if (r.noDiagram) parts.push(`<p class="pv-note">${esc(r.noDiagram)}</p>`);
    }
    if (m.include.tags) {
      parts.push(`<h3>Tags</h3>`);
      if (r.tags.length === 0) parts.push(`<p class="pv-note">No tags${several ? " in this routine" : ""}.</p>`);
      else {
        const rows = r.tags
          .map(
            (t) =>
              `<tr><td class="pv-mono">${esc(t.name)}</td><td class="pv-mono">${esc(t.type)}</td>` +
              `<td class="pv-mono">${t.address ? esc(t.address) : "—"}</td><td>${esc(t.description)}</td></tr>`,
          )
          .join("");
        parts.push(
          `<table class="pv-tags"><thead><tr><th>Name</th><th>Type</th><th>I/O address</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`,
        );
      }
    }
    if (m.include.code && r.code.length) {
      const code = r.code.map((l) => `<span class="pv-ln">${l.n}</span>${esc(l.text)}`).join("\n");
      parts.push(`<h3>Code</h3><pre class="pv-code">${code}</pre>`);
    }
    out.push(`<section class="pv-routine">${parts.join("")}</section>`);
  }
  return out.join("");
}
