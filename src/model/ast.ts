/**
 * Syntax tree produced by the parser (src/parse). It mirrors the text: nesting is
 * explicit, nothing is resolved yet (jump targets are names, tags are not known).
 * See docs/SPEC.md §3-§6.
 */
import type { Span } from "./diagnostics.js";

export interface Name {
  /** As written in the source (original capitalization). Compare with `key()`. */
  text: string;
  span: Span;
}

/** Case-insensitive key for names (SPEC §3.4). */
export function key(name: string): string {
  return name.toLowerCase();
}

/** A piece of source text with the position of its first character. */
export interface SourceText {
  text: string;
  /** Position of text[0] in the file. */
  span: Span;
}

export interface StepNode {
  kind: "step";
  initial: boolean;
  name: Name;
  /** Preset in milliseconds, absent when no duration is written. */
  presetMs?: number;
  /** Text of the "..." string, unescaped. */
  description?: string;
  /**
   * Action lines after dedent (SPEC §4.3): one entry per source line, leading and
   * trailing blank lines removed, inner blank lines kept (text ""). Empty array = no action.
   * Each span points at the first character of the dedented text in the file
   * (for a blank line: column 1 of that line).
   */
  action: SourceText[];
  /** Span of the step line (keyword to end of line). */
  span: Span;
}

export interface TransitionNode {
  kind: "transition";
  /**
   * Final name. For unnamed transitions the parser assigns T1, T2, ... in file order,
   * skipping names used anywhere else in the file (steps, transitions, tag overrides,
   * and identifiers in ST). `auto` tells them apart.
   */
  name: Name;
  auto: boolean;
  /** Condition text, trimmed, without the name part, the jump or the comment. */
  condition: SourceText;
  /** Target of `-> target`, if any. */
  jump?: Name;
  span: Span;
}

export interface BranchNode {
  kind: "select" | "parallel";
  /** At least one leg in the tree even when invalid; validator reports E207/E208. */
  legs: Sequence[];
  /** Span of the `select` / `parallel` line. */
  span: Span;
  /** Span of the matching `end` line; absent when missing (E206). */
  endSpan?: Span;
}

export type Element = StepNode | TransitionNode | BranchNode;
export type Sequence = Element[];

export type TagType = "BOOL" | "DINT" | "REAL" | "TIMER";

export interface TagDecl {
  name: Name;
  /** Absent when only a description is given. Unknown types are reported (E409) and left absent. */
  type?: TagType;
  description?: string;
  span: Span;
}

export interface Chart {
  /** `sfc name` header (SPEC §4.1). */
  header?: Name;
  tagDecls: TagDecl[];
  /**
   * Top-level elements in file order. Chain breaks (after a jump, or after a select
   * whose legs all jump) are not marked here; the validator / lowering work them out.
   */
  body: Sequence;
}

/** Walk every element depth-first in file order. */
export function* walk(seq: Sequence): Generator<Element> {
  for (const el of seq) {
    yield el;
    if (el.kind === "select" || el.kind === "parallel") {
      for (const leg of el.legs) yield* walk(leg);
    }
  }
}

export function allSteps(chart: Chart): StepNode[] {
  return [...walk(chart.body)].filter((e): e is StepNode => e.kind === "step");
}

export function allTransitions(chart: Chart): TransitionNode[] {
  return [...walk(chart.body)].filter((e): e is TransitionNode => e.kind === "transition");
}
