/**
 * Several routines in one file (SPEC §4.5) without the DOM: which routine a source line
 * belongs to, the call tree from the main routine, and the texts of the ST routine card.
 * Unit-tested in test/app.
 */
import type { CompiledRoutine } from "../src/compile.js";
import { allSteps, key, type ProgramNode } from "../src/model/ast.js";
import type { CallRef } from "../src/tags/index.js";
import { routineLabel } from "../src/validate/program.js";
import { plural } from "./format.js";

type RoutineLines = Pick<CompiledRoutine, "lines">;

/**
 * Index of the routine written on `line` (1-based). Lines before the first routine (the
 * `program` line, `tag` lines, comments) belong to the first one. -1 when there is none.
 */
export function routineAtLine(routines: readonly RoutineLines[], line: number): number {
  if (routines.length === 0) return -1;
  let at = 0;
  for (let i = 0; i < routines.length; i++) if (routines[i]!.lines.from <= line) at = i;
  return at;
}

/** The routine named `name` (names are case-insensitive), or undefined. */
export function findRoutine<R extends Pick<CompiledRoutine, "name">>(routines: readonly R[], name: string): R | undefined {
  const k = key(name);
  return routines.find((r) => key(r.name) === k);
}

/** "5 routines (2 SFC, 3 ST)" */
export function routineSummary(routines: readonly Pick<CompiledRoutine, "kind">[]): string {
  const sfc = routines.filter((r) => r.kind === "sfc").length;
  return `${plural(routines.length, "routine")} (${sfc} SFC, ${routines.length - sfc} ST)`;
}

/** Program name: the `program` header, else the main routine's name (SPEC §4.5). */
export function programName(program: Pick<ProgramNode, "header">, routines: readonly Pick<CompiledRoutine, "name">[]): string {
  return program.header?.text ?? routines[0]?.name ?? "";
}

/** Steps of SFC routine `caller` whose action holds a call of `callee`, in file order, unique. */
export function callingSteps(caller: CompiledRoutine, callee: string, calls: readonly CallRef[]): string[] {
  if (caller.node.kind !== "sfc") return [];
  const from = key(routineLabel(caller.node));
  const lines = calls.filter((c) => key(c.from) === from && key(c.name) === key(callee)).map((c) => c.span.line);
  const out: string[] = [];
  for (const s of allSteps(caller.node.chart)) {
    if (s.action.some((a) => lines.includes(a.span.line)) && !out.includes(s.name.text)) out.push(s.name.text);
  }
  return out;
}

export interface TreeRow {
  /** Box-drawing prefix, e.g. "│  └─ ". Empty for the main routine. */
  prefix: string;
  name: string;
  /** undefined for a call of a routine that doesn't exist (E600). */
  kind?: "sfc" | "st";
  /** Shown before (a cycle, or a routine called from several places): not expanded again. */
  again: boolean;
  /** SFC caller: the steps whose action makes the call. */
  fromSteps: string[];
}

/**
 * The call tree drawn from the main routine down. Each routine is expanded once; a later
 * call of it (or a call back up the tree) is a row marked `again`.
 */
export function callTree(routines: readonly CompiledRoutine[], calls: readonly CallRef[]): TreeRow[] {
  const main = routines[0];
  if (!main) return [];
  const rows: TreeRow[] = [{ prefix: "", name: main.name, kind: main.kind, again: false, fromSteps: [] }];
  const expanded = new Set([key(main.name)]);
  const visit = (r: CompiledRoutine, indent: string): void => {
    r.calls.forEach((name, i) => {
      const last = i === r.calls.length - 1;
      const callee = findRoutine(routines, name);
      const again = expanded.has(key(name));
      const row: TreeRow = { prefix: indent + (last ? "└─ " : "├─ "), name: callee?.name ?? name, again, fromSteps: callingSteps(r, name, calls) };
      if (callee) row.kind = callee.kind;
      rows.push(row);
      if (callee && !again) {
        expanded.add(key(name));
        visit(callee, indent + (last ? "   " : "│  "));
      }
    });
  };
  visit(main, "");
  return rows;
}

export interface TreeLine {
  /** Text before the name (the prefix). */
  lead: string;
  name: string;
  /** Text after the name: padding, kind, notes. */
  tail: string;
}

/** Text lines of a call tree, with the kinds in one column. */
export function treeLines(rows: readonly TreeRow[]): TreeLine[] {
  const width = Math.max(0, ...rows.slice(1).map((r) => r.prefix.length + r.name.length));
  return rows.map((r, i) => {
    if (i === 0) return { lead: "", name: r.name, tail: "" };
    let tail = " ".repeat(width - r.prefix.length - r.name.length + 3) + (r.kind ? r.kind.toUpperCase() : "?");
    const notes: string[] = [];
    if (r.fromSteps.length) notes.push(`(from ${r.fromSteps.length > 1 ? "steps" : "step"} ${r.fromSteps.join(", ")})`);
    if (r.again) notes.push("(again)");
    if (!r.kind) notes.push("(no such routine)");
    if (notes.length) tail += `${r.kind === "st" ? "    " : "   "}${notes.join(" ")}`;
    return { lead: r.prefix, name: r.name, tail };
  });
}

/** The call tree as plain text. */
export function formatTree(rows: readonly TreeRow[]): string {
  return treeLines(rows)
    .map((l) => `${l.lead}${l.name}${l.tail}`)
    .join("\n");
}

/** "Called by" line when nothing calls the routine. */
export function notCalledText(isMain: boolean): string {
  return isMain ? "nothing (it's the main routine)" : "nothing — only the main routine runs by itself";
}

/** Number of ST lines of an ST routine (its body after dedent), as a sentence. */
export function stLinesText(routine: CompiledRoutine, isMain: boolean): string {
  const n = routine.node.kind === "st" ? routine.node.body.length : 0;
  const lines = n === 0 ? "No ST lines yet." : `${plural(n, "line")} of ST.`;
  return isMain ? `Studio runs the main routine every scan. ${lines}` : lines;
}
