/**
 * Problems panel logic without the DOM: ordering, counts, and which diagram element
 * (or tag) a diagnostic points at. Unit-tested in test/app.
 */
import type { Diagnostic } from "../src/model/diagnostics.js";
import type { Graph, TagInfo } from "../src/model/graph.js";

/** Errors first, then warnings; each by line, then column, then code. */
export function orderProblems(diags: readonly Diagnostic[]): Diagnostic[] {
  const rank = (d: Diagnostic): number => (d.severity === "error" ? 0 : 1);
  return [...diags].sort(
    (a, b) =>
      rank(a) - rank(b) || a.span.line - b.span.line || a.span.col - b.span.col || a.code.localeCompare(b.code),
  );
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
}

export function countProblems(diags: readonly Diagnostic[]): ProblemCounts {
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** "12:3" */
export function problemLocation(d: Diagnostic): string {
  return `${d.span.line}:${d.span.col}`;
}

/** Stable key for one diagnostic in a list (selection survives re-render). */
export function problemKey(d: Diagnostic): string {
  return `${d.code}@${d.span.line}:${d.span.col}`;
}

/**
 * The `data-id` of the diagram element a diagnostic points at, or undefined.
 * Matching is by line: a step line or one of its action lines → step; a transition
 * line → transition; a `select`/`parallel` line → its diverge bar; its `end` line →
 * its converge bar. Only possible when there is a graph (no errors).
 */
export function problemTarget(d: Diagnostic, graph: Graph | undefined): string | undefined {
  if (!graph) return undefined;
  const line = d.span.line;
  for (const s of graph.steps) {
    if (s.node.span.line === line) return s.id;
  }
  for (const t of graph.transitions) {
    if (t.node.span.line === line) return t.id;
  }
  for (const s of graph.steps) {
    if (s.node.action.some((a) => a.span.line === line)) return s.id;
  }
  for (const b of graph.branches) {
    if (!b.node) continue;
    if (b.flow === "diverge" && b.node.span.line === line) return b.id;
    if (b.flow === "converge" && b.node.endSpan?.line === line) return b.id;
  }
  return undefined;
}

/** Name of the tag whose use (or declaration line) the diagnostic points at, if any. */
export function problemTag(d: Diagnostic, tags: readonly TagInfo[], declLines?: ReadonlyMap<string, number>): string | undefined {
  for (const t of tags) {
    if (t.uses.some((u) => u.line === d.span.line && u.col === d.span.col)) return t.name;
  }
  if (declLines) {
    for (const [name, line] of declLines) if (line === d.span.line) return name;
  }
  return undefined;
}
