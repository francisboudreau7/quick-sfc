import type { Chart, Sequence, SourceText, TagDecl, TagType } from "../../src/model/ast.js";
import type { Diagnostic } from "../../src/model/diagnostics.js";
import type { TagInfo } from "../../src/model/graph.js";
import { analyzeTags } from "../../src/tags/index.js";

export interface StepSpec {
  step: string;
  init?: boolean;
  presetMs?: number;
  /** Action lines as they appear after dedent (relative indentation kept). */
  action?: string[];
}
export interface TranSpec {
  /** Condition text. */
  tran: string;
  name?: string;
}
export interface DeclSpec {
  name: string;
  type?: TagType;
  description?: string;
}
export type El = StepSpec | TranSpec;

export interface Opts {
  body?: El[];
  steps?: StepSpec[];
  transitions?: TranSpec[];
  tagDecls?: DeclSpec[];
}

export interface Built {
  chart: Chart;
  /** The source text the synthetic spans refer to (index 0 = line 1). */
  lines: string[];
}

/**
 * Builds a flat chart with consistent synthetic spans. Layout: one line per tag declaration
 * (`tag name`), then per step `step name [..]` + one line per action line (indented by 2, so the
 * SourceText starts at column 3), then `-- [name: ]condition` (condition at its real column).
 */
export function built(o: Opts): Built {
  const lines: string[] = [];
  const decls: TagDecl[] = [];
  for (const d of o.tagDecls ?? []) {
    const line = lines.length + 1;
    lines.push(`tag ${d.name}${d.type ? ` : ${d.type}` : ""}${d.description ? ` "${d.description}"` : ""}`);
    decls.push({
      name: { text: d.name, span: { line, col: 5 } },
      ...(d.type ? { type: d.type } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      span: { line, col: 1 },
    });
  }
  const body: Sequence = [];
  let auto = 0;
  const els: El[] = o.body ?? [...(o.steps ?? []), ...(o.transitions ?? [])];
  for (const e of els) {
    if ("step" in e) {
      const line = lines.length + 1;
      lines.push(`${e.init ? "init" : "step"} ${e.step}${e.presetMs ? ` ${e.presetMs}ms` : ""}`);
      const action: SourceText[] = [];
      for (const a of e.action ?? []) {
        const l = lines.length + 1;
        lines.push(a === "" ? "" : `  ${a}`);
        action.push({ text: a, span: { line: l, col: a === "" ? 1 : 3 } });
      }
      body.push({
        kind: "step",
        initial: !!e.init,
        name: { text: e.step, span: { line, col: e.init ? 6 : 6 } },
        ...(e.presetMs !== undefined ? { presetMs: e.presetMs } : {}),
        actions: action.length ? [{ qualifier: "N", lines: action, span: action[0]!.span }] : [],
        action,
        span: { line, col: 1 },
      });
    } else {
      const line = lines.length + 1;
      auto++;
      const name = e.name ?? `T${auto}`;
      const prefix = e.name ? `-- ${e.name}: ` : "-- ";
      lines.push(`${prefix}${e.tran}`);
      body.push({
        kind: "transition",
        name: { text: name, span: { line, col: 4 } },
        auto: !e.name,
        condition: { text: e.tran, span: { line, col: prefix.length + 1 } },
        span: { line, col: 1 },
      });
    }
  }
  return { chart: { tagDecls: decls, body }, lines };
}

export function chart(o: Opts): Chart {
  return built(o).chart;
}

export interface Result {
  tags: TagInfo[];
  diagnostics: Diagnostic[];
  lines: string[];
}

export function run(o: Opts): Result {
  const b = built(o);
  return { ...analyzeTags(b.chart), lines: b.lines };
}

/** Actions in a single step `s0` (with an optional preset). */
export function act(action: string[], extra: Opts = {}): Result {
  return run({ ...extra, body: [{ step: "s0", init: true, action }, ...(extra.body ?? [])] });
}

/** Conditions as transitions after a step `s0`. */
export function cond(...conds: string[]): Result {
  return run({ body: [{ step: "s0", init: true }, ...conds.map((c) => ({ tran: c }))] });
}

export const codes = (r: { diagnostics: Diagnostic[] }): string[] => r.diagnostics.map((d) => d.code);
export const byCode = (r: { diagnostics: Diagnostic[] }, code: string): Diagnostic[] =>
  r.diagnostics.filter((d) => d.code === code);
export const tagType = (r: { tags: TagInfo[] }, name: string): TagType | undefined =>
  r.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())?.type;

/** 1-based column of the nth occurrence of `needle` on 1-based `line`. */
export function colOf(lines: string[], line: number, needle: string, nth = 0): number {
  const s = lines[line - 1] ?? "";
  let from = 0;
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = s.indexOf(needle, from);
    from = idx + 1;
  }
  return idx + 1;
}
