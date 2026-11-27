/**
 * "Where a tag is used" (Phase 4c) without the DOM: the diagram elements using a tag, the
 * routines using it, the next use after the cursor, and the tag name inside a text.
 * Unit-tested in test/app.
 */
import type { Span } from "../src/model/diagnostics.js";
import type { Graph } from "../src/model/graph.js";
import { routineAtLine } from "./routines.js";

/** `data-id`s of the steps (action lines) and transitions (condition) holding one of the uses. */
export function tagElements(graph: Graph | undefined, uses: readonly Span[]): string[] {
  if (!graph || uses.length === 0) return [];
  const lines = new Set(uses.map((u) => u.line));
  const out: string[] = [];
  for (const s of graph.steps) {
    if (s.node.action.some((a) => lines.has(a.span.line))) out.push(s.id);
  }
  for (const t of graph.transitions) {
    if (lines.has(t.node.condition.span.line) || lines.has(t.node.span.line)) out.push(t.id);
  }
  return out;
}

/** Positions (in `routines`) of the routines holding a use, ascending. */
export function routinesUsing(routines: ReadonlyArray<{ lines: { from: number; to: number } }>, uses: readonly Span[]): number[] {
  const out = new Set<number>();
  for (const u of uses) {
    const i = routineAtLine(routines, u.line);
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

const before = (a: { line: number; col: number }, b: { line: number; col: number }): boolean =>
  a.line < b.line || (a.line === b.line && a.col < b.col);

/** The first use after the cursor (a use starting at the cursor counts as passed), wrapping around. */
export function nextUse(uses: readonly Span[], cursor: { line: number; col: number }): Span | undefined {
  const sorted = [...uses].sort((a, b) => a.line - b.line || a.col - b.col);
  return sorted.find((u) => before(cursor, u)) ?? sorted[0];
}

/** Index (1-based) of `use` among the uses, for "use 2 of 3". */
export function useIndex(uses: readonly Span[], use: Span): number {
  const sorted = [...uses].sort((a, b) => a.line - b.line || a.col - b.col);
  return sorted.findIndex((u) => u.line === use.line && u.col === use.col) + 1;
}

export interface TextPart {
  text: string;
  hit: boolean;
}

/**
 * `text` cut around each whole-word occurrence of `name` (case-insensitive), not after a
 * `.` (a member such as `fill.done` is not the tag `done`) and outside `'…'` / `"…"` strings.
 */
export function splitOnName(text: string, name: string): TextPart[] {
  if (!name) return [{ text, hit: false }];
  const out: TextPart[] = [];
  const lower = text.toLowerCase();
  const k = name.toLowerCase();
  let last = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") break; // comment
    if (!lower.startsWith(k, i)) continue;
    const prev = text[i - 1];
    const next = text[i + k.length];
    if ((prev && /[\w.]/.test(prev)) || (next && /\w/.test(next))) continue;
    if (i > last) out.push({ text: text.slice(last, i), hit: false });
    out.push({ text: text.slice(i, i + k.length), hit: true });
    last = i + k.length;
    i = last - 1;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}
