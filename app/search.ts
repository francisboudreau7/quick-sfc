/**
 * Search in the diagram (Ctrl+F on the canvas, Phase 4c) without the DOM: step names,
 * transition conditions and action text, case-insensitive. One match per diagram element,
 * in file order, with where the matched text is written (to select it in the editor).
 * Unit-tested in test/app.
 */
import type { Graph } from "../src/model/graph.js";

export interface DiagramMatch {
  /** `data-id` of the step or transition. */
  id: string;
  /** What matched first in the element. */
  field: "name" | "condition" | "action";
  /** The matched text in the file: 1-based line and column, and its length. */
  line: number;
  col: number;
  length: number;
}

export function searchDiagram(graph: Graph | undefined, query: string): DiagramMatch[] {
  const q = query.trim().toLowerCase();
  if (!graph || !q) return [];
  const out: Array<DiagramMatch & { order: number }> = [];
  const find = (text: string): number => text.toLowerCase().indexOf(q);
  for (const s of graph.steps) {
    const order = s.node.span.line;
    const n = find(s.name);
    if (n >= 0) {
      out.push({ id: s.id, field: "name", line: s.node.name.span.line, col: s.node.name.span.col + n, length: q.length, order });
      continue;
    }
    for (const a of s.node.action) {
      const i = find(a.text);
      if (i >= 0) {
        out.push({ id: s.id, field: "action", line: a.span.line, col: a.span.col + i, length: q.length, order });
        break;
      }
    }
  }
  for (const t of graph.transitions) {
    const c = t.node.condition;
    const i = find(c.text);
    if (i >= 0) out.push({ id: t.id, field: "condition", line: c.span.line, col: c.span.col + i, length: q.length, order: t.node.span.line });
  }
  return out.sort((a, b) => a.order - b.order || a.line - b.line || a.col - b.col).map(({ order: _order, ...m }) => m);
}

/** Next (dir 1) or previous (dir -1) match index, wrapping around; -1 without matches. */
export function cycleIndex(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir > 0 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** "1 of 2", "No matches", or "" for an empty query. */
export function matchLabel(index: number, count: number, query: string): string {
  if (!query.trim()) return "";
  if (count === 0) return "No matches";
  return `${index + 1} of ${count}`;
}
