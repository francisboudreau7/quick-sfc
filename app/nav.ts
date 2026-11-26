/**
 * Editor <-> diagram navigation without the DOM: which diagram element a source line
 * belongs to, where an element is written, and how a diagnostic span becomes an editor
 * range. Unit-tested in test/app.
 */
import type { Span } from "../src/model/diagnostics.js";
import type { Graph } from "../src/model/graph.js";

/**
 * The `data-id` of the diagram element written on `line` (1-based): a step line or one of
 * its action lines → the step; a transition line → the transition; a `select`/`parallel`
 * line → its diverge bar; its `end` line → its converge bar.
 */
export function elementAtLine(graph: Graph | undefined, line: number): string | undefined {
  if (!graph) return undefined;
  for (const s of graph.steps) if (s.node.span.line === line) return s.id;
  for (const t of graph.transitions) if (t.node.span.line === line) return t.id;
  for (const s of graph.steps) if (s.node.action.some((a) => a.span.line === line)) return s.id;
  for (const b of graph.branches) {
    if (!b.node) continue;
    if (b.flow === "diverge" && b.node.span.line === line) return b.id;
    if (b.flow === "converge" && b.node.endSpan?.line === line) return b.id;
  }
  return undefined;
}

/** Where the element with this `data-id` is written: its line and the column of its name. */
export function sourceOfElement(graph: Graph | undefined, id: string): { line: number; col: number } | undefined {
  if (!graph) return undefined;
  const s = graph.steps.find((x) => x.id === id);
  if (s) return { line: s.node.name.span.line, col: s.node.name.span.col };
  const t = graph.transitions.find((x) => x.id === id);
  if (t) {
    // Auto-named transitions have no name in the text: point at the condition.
    const at = t.auto ? t.node.condition.span : t.node.name.span;
    return { line: at.line, col: at.col };
  }
  const b = graph.branches.find((x) => x.id === id);
  if (b?.node) {
    const span = b.flow === "converge" ? (b.node.endSpan ?? b.node.span) : b.node.span;
    return { line: span.line, col: span.col };
  }
  return undefined;
}

/** The nearest element id up the DOM-like chain: `data-id` values of the clicked node and its ancestors. */
export function pickElement(ids: ReadonlyArray<string | undefined>, graph: Graph | undefined): string | undefined {
  for (const id of ids) {
    if (id && sourceOfElement(graph, id)) return id;
  }
  return undefined;
}

export interface LineText {
  /** 0-based document offset of the line start. */
  from: number;
  text: string;
}

/**
 * Editor range [from, to) of a diagnostic. `line(n)` returns line n (1-based) of the
 * current document, or undefined when the document has fewer lines. Without an end, the
 * range covers the word (or the run of non-blank characters) at the column; on an empty
 * line or past its end it covers the last character, so the underline stays visible.
 */
export function spanToRange(span: Span, line: (n: number) => LineText | undefined, lineCount: number): { from: number; to: number } {
  const ln = line(Math.min(Math.max(1, span.line), lineCount));
  if (!ln) return { from: 0, to: 0 };
  const len = ln.text.length;
  const col = Math.min(Math.max(0, span.col - 1), len);
  const from = ln.from + col;
  if (span.endLine !== undefined && span.endCol !== undefined) {
    const endLn = line(Math.min(span.endLine, lineCount));
    if (endLn) {
      const to = endLn.from + Math.min(Math.max(0, span.endCol - 1), endLn.text.length);
      if (to > from) return { from, to };
    }
  }
  const rest = ln.text.slice(col);
  const m = /^[A-Za-z0-9_]+/.exec(rest) ?? /^\S+/.exec(rest);
  if (m) return { from, to: from + m[0].length };
  if (len === 0) return { from: ln.from, to: ln.from };
  return { from: ln.from + len - 1, to: ln.from + len };
}
