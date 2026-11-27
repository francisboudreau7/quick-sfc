/**
 * Glue between the pipeline stages (docs/ARCHITECTURE.md). Pure: no file I/O.
 */
import { key, type Chart, type ProgramNode, type RoutineNode } from "./model/ast.js";
import { hasErrors, sortDiagnostics, error, type Diagnostic } from "./model/diagnostics.js";
import type { Graph, TagInfo } from "./model/graph.js";
import type { L5XPositions } from "./model/positions.js";
import { parse } from "./parse/index.js";
import { validateProgram } from "./validate/index.js";
import { routineLabel } from "./validate/program.js";
import { analyzeTags, rewriteBoolLiterals, rewriteCalls, rewriteStepRefs, type CallRef } from "./tags/index.js";
import { lower } from "./lower/index.js";
import { layout as computeLayout, l5xPositions, type Layout } from "./layout/index.js";
import { renderAscii } from "./render/ascii.js";
import { hiddenJumpLinks } from "./render/svg.js";
import { writeProgramL5X, type L5XProgramOptions, type L5XRoutine } from "./l5x/index.js";

/** One routine of the compiled file, in file order (SPEC §4.5). */
export interface CompiledRoutine {
  kind: "sfc" | "st";
  /** Final name: the header, or (header-less first routine) the file name made valid. */
  name: string;
  /** true when the name comes from the file name. */
  fromFile: boolean;
  node: RoutineNode;
  /** First and last source line of the routine (header included). */
  lines: { from: number; to: number };
  /** Routines this one calls (as written in the routine list), unique, in order of first call. */
  calls: string[];
  /** Routines that call this one, in file order. */
  calledBy: string[];
  /** SFC only, present only when the file has no errors. */
  graph?: Graph;
  layout?: Layout;
  positions?: L5XPositions;
}

export interface CompileResult {
  program: ProgramNode;
  /** First SFC routine (an empty chart when there is none). */
  chart: Chart;
  /** Sorted by position. */
  diagnostics: Diagnostic[];
  tags: TagInfo[];
  calls: CallRef[];
  routines: CompiledRoutine[];
  /** First SFC routine's graph, layout and positions: present only when there are no errors. */
  graph?: Graph;
  layout?: Layout;
  positions?: L5XPositions;
}

export interface CompileOptions {
  /** Names a header-less first routine (SPEC §4.1). Default "sfc". */
  fileName?: string;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parse(source);
  const program = parsed.program;
  const diagnostics = [...parsed.diagnostics];
  const tagResult = analyzeTags(program);
  diagnostics.push(...validateProgram(program, tagResult.calls));
  diagnostics.push(...tagResult.diagnostics);

  const routines = describeRoutines(program, tagResult.calls, source, options.fileName ?? "sfc");
  const result: CompileResult = {
    program,
    chart: parsed.chart,
    diagnostics: sortDiagnostics(diagnostics),
    tags: tagResult.tags,
    calls: tagResult.calls,
    routines,
  };
  if (hasErrors(diagnostics)) return result;

  const base = { steps: 0, transitions: 0 };
  for (const r of routines) {
    if (r.node.kind !== "sfc") continue;
    r.graph = lower(r.node.chart, base);
    r.layout = computeLayout(r.graph, r.node.chart);
    // action box as exported: the name comment line plus the action (SPEC §8.3)
    const actionLines = new Map(r.graph.steps.map((s) => [s.id, s.action.length + 1] as const));
    r.positions = l5xPositions(r.layout, actionLines);
    base.steps += r.graph.steps.length;
    base.transitions += r.graph.transitions.length;
  }
  const first = routines.find((r) => r.kind === "sfc");
  if (first?.graph) {
    result.graph = first.graph;
    result.layout = first.layout;
    result.positions = first.positions;
  }
  return result;
}

function describeRoutines(program: ProgramNode, calls: CallRef[], source: string, fileName: string): CompiledRoutine[] {
  const lineCount = source.split(/\r?\n/).length;
  const byKey = new Map<string, string>();
  const out: CompiledRoutine[] = program.routines.map((node) => {
    const label = routineLabel(node);
    const name = label || (node.kind === "sfc" ? routineName(node.chart, fileName) : "");
    if (label && !byKey.has(key(label))) byKey.set(key(label), label);
    return { kind: node.kind, name, fromFile: !label, node, lines: { from: firstLine(node), to: lineCount }, calls: [], calledBy: [] };
  });
  for (let i = 0; i + 1 < out.length; i++) out[i]!.lines.to = Math.max(out[i]!.lines.from, out[i + 1]!.lines.from - 1);
  const byLabel = new Map(out.map((r) => [key(routineLabel(r.node)), r]));
  for (const c of calls) {
    const target = byKey.get(key(c.name));
    const from = byLabel.get(key(c.from));
    if (!target || !from) continue;
    if (!from.calls.some((n) => key(n) === key(target))) from.calls.push(target);
  }
  for (const r of out) {
    for (const t of r.calls) {
      const callee = byLabel.get(key(t));
      if (callee && !callee.calledBy.includes(r.name)) callee.calledBy.push(r.name);
    }
  }
  return out;
}

function firstLine(node: RoutineNode): number {
  if (node.kind === "st") return node.span.line;
  if (node.span) return node.span.line;
  const el = node.chart.body[0];
  return el ? el.span.line : 1;
}

/** Routine name: `sfc` header, else the file name made into a valid Studio name (SPEC §4.1). */
export function routineName(chart: Chart, fileName: string): string {
  if (chart.header) return chart.header.text;
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  let name = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/_+$/, "");
  if (!/^[A-Za-z_]/.test(name)) name = `sfc_${name}`;
  return name.slice(0, 40).replace(/_+$/, "") || "sfc";
}

const VALID_NAME = /^[A-Za-z_](?!.*__)[A-Za-z0-9_]{0,39}$/;

export interface ExportOptions {
  fileName: string;
  programName?: string;
  softwareRevision?: string;
  exportDate?: Date;
}

export interface ExportResult {
  text?: string;
  diagnostics: Diagnostic[];
}

/** Compile and, when there are no errors, produce the L5X text (with BOM and CRLF). */
export function exportL5X(source: string, options: ExportOptions): ExportResult {
  const result = compile(source, { fileName: options.fileName });
  const diagnostics = [...result.diagnostics];
  if (hasErrors(diagnostics) || result.routines.length === 0) return { diagnostics };

  const main = result.routines[0]!;
  const program = options.programName ?? result.program.header?.text ?? main.name;
  const at = { line: 1, col: 1 };
  const checks: Array<[string, string]> = [["program", program]];
  for (const r of result.routines) if (r.fromFile) checks.push(["routine", r.name]);
  for (const [what, value] of checks) {
    if (!VALID_NAME.test(value) || value.endsWith("_")) {
      diagnostics.push(error("E502", at, `${what} name '${value}' is not a valid Studio 5000 name`));
    }
  }
  const taken = new Set(result.routines.filter((r) => !r.fromFile).map((r) => key(r.name)));
  for (const r of result.routines) {
    if (r.fromFile && taken.has(key(r.name))) {
      diagnostics.push(error("E502", at, `routine name '${r.name}' (from the file name) is already used: add a header \`sfc name\``));
    }
  }
  if (options.softwareRevision !== undefined && !/^\d{1,3}\.\d{2}$/.test(options.softwareRevision)) {
    diagnostics.push(error("E501", at, `software revision '${options.softwareRevision}' should look like 32.01`));
  }
  if (hasErrors(diagnostics)) return { diagnostics: sortDiagnostics(diagnostics) };

  const operands = operandMap(result.routines);
  const routines: L5XRoutine[] = result.routines.map((r) =>
    r.node.kind === "st"
      ? { kind: "st", name: r.name, lines: rewriteLines(r.node.body.map((l) => l.text), operands) }
      : sfcForL5X(r.name, r.graph!, r.layout!, r.positions!, operands),
  );
  const l5xOptions: L5XProgramOptions = { programName: program };
  if (options.softwareRevision !== undefined) l5xOptions.softwareRevision = options.softwareRevision;
  if (options.exportDate !== undefined) l5xOptions.exportDate = options.exportDate;
  const text = writeProgramL5X(routines, result.tags, l5xOptions);
  return { text, diagnostics };
}

function sfcForL5X(
  name: string,
  graph: Graph,
  layout: Layout,
  positions: L5XPositions,
  operands: Map<string, string>,
): L5XRoutine {
  // action box as exported: the name comment line plus the action (SPEC §8.3)
  const actionLines = new Map(graph.steps.map((s) => [s.id, s.action.length + 1] as const));
  const placed = studioPositions(graph, layout, actionLines, positions);
  return { kind: "sfc", name, graph: rewriteGraph(graph, operands), positions: placed.positions, hiddenLinks: placed.hiddenLinks };
}

/**
 * Studio 5000 coordinates as exported, and the hidden wires (Show="false"). Shared by the export
 * and Tidy (src/tidy). `actionLines`: step id -> lines of its action box(es) in Studio.
 * `positions`, when given, is reused when no wire is hidden (same result as without hidden wires).
 */
export function studioPositions(
  graph: Graph,
  layout: Layout,
  actionLines: ReadonlyMap<string, number>,
  positions?: L5XPositions,
): { positions: L5XPositions; hiddenLinks: Set<string> } {
  // Wires the app draws as cross-references are hidden in Studio too (SPEC §8.2). Studio writes
  // the target's name under such a transition: the row below gets more room, and the
  // transition moves right when it starts a leg (tp05 imports, 2026-11-26).
  const hiddenLinks = hiddenJumpLinks(graph, layout);
  const hiddenFrom = new Set([...hiddenLinks].map((id) => id.slice(0, id.indexOf("-"))));
  // the target is a step, or a convergence leg "b3.1" whose bar is "b3"
  const hiddenTo = new Set([...hiddenLinks].map((id) => id.slice(id.indexOf("-") + 1).replace(/\.\d+$/, "")));
  const legStart = new Set(graph.links.filter((l) => l.from.includes(".")).map((l) => l.to));
  const final = hiddenFrom.size
    ? l5xPositions(layout, { actionLines, hiddenFrom, hiddenTo, legStart })
    : (positions ?? l5xPositions(layout, actionLines));
  return { positions: final, hiddenLinks };
}

function operandMap(routines: CompiledRoutine[]): Map<string, string> {
  const operands = new Map<string, string>();
  for (const r of routines) {
    for (const s of r.graph?.steps ?? []) operands.set(key(s.name), `Step_${String(s.index).padStart(3, "0")}`);
  }
  return operands;
}

/**
 * ST as exported: `call x` → `JSR(x,0)` (SPEC §4.5), `step.member` → operand (SPEC §8.4),
 * `TRUE`/`FALSE` → `1`/`0` (SPEC §8.4).
 */
function rewriteSt(text: string, operands: Map<string, string>): string {
  return rewriteBoolLiterals(rewriteStepRefs(rewriteCalls(text), operands));
}

/** Rewrites a block of ST lines as one text, so a `(* ... *)` comment spanning lines is skipped. */
function rewriteLines(lines: string[], operands: Map<string, string>): string[] {
  return lines.length ? rewriteSt(lines.join("\n"), operands).split("\n") : [];
}

function rewriteGraph(graph: Graph, operands: Map<string, string>): Graph {
  return {
    ...graph,
    steps: graph.steps.map((s) => ({ ...s, action: rewriteLines(s.action, operands) })),
    transitions: graph.transitions.map((t) => ({ ...t, condition: rewriteSt(t.condition, operands) })),
  };
}

/** Copy of the graph where `step.member` references use operands (SPEC §8.4) and `call` is JSR. */
export function withRewrittenRefs(graph: Graph): Graph {
  const operands = new Map<string, string>();
  for (const s of graph.steps) operands.set(key(s.name), `Step_${String(s.index).padStart(3, "0")}`);
  return rewriteGraph(graph, operands);
}

/** ASCII view for `qsfc show`. Several routines are printed one after the other. */
export function showAscii(source: string, options: CompileOptions = {}): { text?: string; diagnostics: Diagnostic[] } {
  const result = compile(source, options);
  if (hasErrors(result.diagnostics) || result.routines.length === 0) return { diagnostics: result.diagnostics };
  const only = result.routines.length === 1 ? result.routines[0]! : undefined;
  if (only?.graph && only.layout) return { text: renderAscii(only.graph, only.layout), diagnostics: result.diagnostics };

  const parts = result.routines.map((r, i) => {
    const title = `== ${r.kind} ${r.name}${i === 0 ? " (main)" : ""} ==`;
    const lines = [title];
    if (r.calledBy.length) lines.push(`called by: ${r.calledBy.join(", ")}`);
    if (r.calls.length) lines.push(`calls: ${r.calls.join(", ")}`);
    if (r.graph && r.layout) lines.push("", renderAscii(r.graph, r.layout).trimEnd());
    else if (r.node.kind === "st") {
      lines.push("", ...(r.node.body.length ? r.node.body.map((l) => (l.text ? `  ${l.text}` : "")) : ["  (empty)"]));
    }
    return lines.join("\n");
  });
  return { text: parts.join("\n\n"), diagnostics: result.diagnostics };
}
