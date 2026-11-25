/**
 * Glue between the pipeline stages (docs/ARCHITECTURE.md). Pure: no file I/O.
 */
import { key, type Chart } from "./model/ast.js";
import { hasErrors, sortDiagnostics, error, type Diagnostic } from "./model/diagnostics.js";
import type { Graph, TagInfo } from "./model/graph.js";
import type { L5XPositions } from "./model/positions.js";
import { parse } from "./parse/index.js";
import { validate } from "./validate/index.js";
import { analyzeTags, rewriteStepRefs } from "./tags/index.js";
import { lower } from "./lower/index.js";
import { layout as computeLayout, l5xPositions, type Layout } from "./layout/index.js";
import { renderAscii } from "./render/ascii.js";
import { writeL5X, type L5XOptions } from "./l5x/index.js";

export interface CompileResult {
  chart: Chart;
  /** Sorted by position. */
  diagnostics: Diagnostic[];
  tags: TagInfo[];
  /** Present only when there are no errors. */
  graph?: Graph;
  layout?: Layout;
  positions?: L5XPositions;
}

export function compile(source: string): CompileResult {
  const parsed = parse(source);
  const diagnostics = [...parsed.diagnostics];
  diagnostics.push(...validate(parsed.chart));
  const tagResult = analyzeTags(parsed.chart);
  diagnostics.push(...tagResult.diagnostics);

  const result: CompileResult = {
    chart: parsed.chart,
    diagnostics: sortDiagnostics(diagnostics),
    tags: tagResult.tags,
  };
  if (hasErrors(diagnostics)) return result;

  result.graph = lower(parsed.chart);
  result.layout = computeLayout(result.graph, parsed.chart);
  result.positions = l5xPositions(result.layout);
  return result;
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
  const result = compile(source);
  const diagnostics = [...result.diagnostics];
  if (!result.graph || !result.positions) return { diagnostics };

  const routine = routineName(result.chart, options.fileName);
  const program = options.programName ?? routine;
  const at = { line: 1, col: 1 };
  for (const [what, value] of [["routine", routine], ["program", program]] as const) {
    if (!VALID_NAME.test(value) || value.endsWith("_")) {
      diagnostics.push(error("E502", at, `${what} name '${value}' is not a valid Studio 5000 name`));
    }
  }
  if (options.softwareRevision !== undefined && !/^\d{1,3}\.\d{2}$/.test(options.softwareRevision)) {
    diagnostics.push(error("E501", at, `software revision '${options.softwareRevision}' should look like 32.01`));
  }
  if (hasErrors(diagnostics)) return { diagnostics: sortDiagnostics(diagnostics) };

  const graph = withRewrittenRefs(result.graph);
  const l5xOptions: L5XOptions = { programName: program, routineName: routine };
  if (options.softwareRevision !== undefined) l5xOptions.softwareRevision = options.softwareRevision;
  if (options.exportDate !== undefined) l5xOptions.exportDate = options.exportDate;
  const text = writeL5X(graph, result.positions, result.tags, l5xOptions);
  return { text, diagnostics };
}

/** Copy of the graph where `step.member` references use operands (SPEC §8.4). */
export function withRewrittenRefs(graph: Graph): Graph {
  const operands = new Map<string, string>();
  for (const s of graph.steps) operands.set(key(s.name), `Step_${String(s.index).padStart(3, "0")}`);
  return {
    ...graph,
    steps: graph.steps.map((s) => ({ ...s, action: s.action.map((l) => rewriteStepRefs(l, operands)) })),
    transitions: graph.transitions.map((t) => ({ ...t, condition: rewriteStepRefs(t.condition, operands) })),
  };
}

/** ASCII view for `qsfc show`. */
export function showAscii(source: string): { text?: string; diagnostics: Diagnostic[] } {
  const result = compile(source);
  if (!result.graph || !result.layout) return { diagnostics: result.diagnostics };
  return { text: renderAscii(result.graph, result.layout), diagnostics: result.diagnostics };
}
