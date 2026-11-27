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

/** IEC 61131-3 action qualifiers supported today (SPEC §4.3). */
export type Qualifier = "N" | "S" | "R" | "L" | "D" | "P";

/** Output sugar (SPEC §4.3): `on a, b`, `set a`, `reset a, b`. */
export interface Sugar {
  verb: "on" | "set" | "reset";
  /** At least one name; each span points at the name in the file. */
  names: Name[];
  /** Trailing `// comment` as written, if any (kept in the expansion). */
  comment?: string;
}

/** An action line: ST as written (after dedent). For a sugar line, `text` is still the raw line. */
export interface ActionLine extends SourceText {
  sugar?: Sugar;
}

/** One action of a step (SPEC §4.3). */
export interface ActionNode {
  qualifier: Qualifier;
  /** L and D: the duration written on the qualifier line, in milliseconds. */
  timeMs?: number;
  /**
   * Lines after dedent (each action on its own): leading and trailing blank lines removed,
   * inner blank lines kept (text ""). Never empty (an empty action is E112).
   */
  lines: ActionLine[];
  /** The qualifier line (`S`, `L 10s`); absent for the N action formed by the lines before any qualifier line. */
  header?: Span;
  /** The qualifier line, else the first line of the action. */
  span: Span;
}

/** ST text of an action line: the line itself, or the expansion of a sugar line (SPEC §4.3). */
export function actionLineText(line: ActionLine): string {
  const s = line.sugar;
  if (!s) return line.text;
  const op = s.verb === "on" ? "[:=] 1" : s.verb === "set" ? ":= 1" : ":= 0";
  const st = s.names.map((n) => `${n.text} ${op};`).join(" ");
  return s.comment ? `${st} ${s.comment}` : st;
}

export interface StepNode {
  kind: "step";
  initial: boolean;
  name: Name;
  /** Preset in milliseconds, absent when no duration is written. */
  presetMs?: number;
  /** Text of the "..." string, unescaped. */
  description?: string;
  /** The step's actions in source order (SPEC §4.3). Empty array = no action. */
  actions: ActionNode[];
  /**
   * Every line of every action, in source order (qualifier lines excluded): the same as
   * `actions.flatMap((a) => a.lines)`. One entry per source line after dedent, inner blank
   * lines kept (text ""). Each span points at the first character of the dedented text in
   * the file (for a blank line: column 1 of that line).
   */
  action: ActionLine[];
  /** Span of the step line (keyword to end of line). */
  span: Span;
}

/**
 * Readable step members (SPEC §7.3, Phase 4c): `fill.active` = `fill.X`, `.done` = `.DN`,
 * `.time` = `.T`, `.first` = `.FS`. Keys are lower-case; the export writes the Studio member.
 */
export const READABLE_MEMBERS: Readonly<Record<string, string>> = { active: "X", done: "DN", time: "T", first: "FS" };

const STEP_PIN = /^s(0|[1-9]\d*)$/i;
const TRANS_PIN = /^tr(0|[1-9]\d*)$/i;

/** The operand number a name pins (`s3` -> 3 for a step, `tr3` -> 3 for a named transition), if any (SPEC §8.2). */
export function pinnedOperand(kind: "step" | "transition", name: string): number | undefined {
  const m = (kind === "step" ? STEP_PIN : TRANS_PIN).exec(name);
  return m ? Number(m[1]) : undefined;
}

export type OperandKind = "step" | "transition" | "action";
const OPERAND_NAME = /^(step|tran|action)_(\d+)$/i;

/** `Step_017` -> {kind: "step", number: 17}: a Studio operand name (SPEC §8.2), if it is one. */
export function operandName(name: string): { kind: OperandKind; number: number } | undefined {
  const m = OPERAND_NAME.exec(name);
  if (!m) return undefined;
  const w = m[1]!.toLowerCase();
  return { kind: w === "step" ? "step" : w === "tran" ? "transition" : "action", number: Number(m[2]) };
}

/** `after 5s` in a condition (SPEC §4.4, Phase 4c): the step above has been active that long. */
export interface AfterTerm {
  /** The duration in ms; absent when the duration is invalid (E104/E105 reported). */
  ms?: number;
  /** `after 5s` in the file. */
  span: Span;
  /** Offsets of `after 5s` in the condition text (`condition.text`), end exclusive. */
  start: number;
  end: number;
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
  /** `after 5s` terms of the condition, in text order (absent when there are none). */
  after?: AfterTerm[];
  /** `-- else` (SPEC §5.1, Phase 4e): true when every other leg of its `select` is false. */
  else?: true;
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

/**
 * `SFC_STEP` / `SFC_ACTION` only declare the tag of an element of another routine
 * (`tag Step_016 : SFC_STEP`, SPEC §7.3): an operand name, never a tag of the code.
 */
export type TagType = "BOOL" | "DINT" | "REAL" | "TIMER" | "SFC_STEP" | "SFC_ACTION";

export interface TagDecl {
  name: Name;
  /** Absent when only a description is given. Unknown types are reported (E409) and left absent. */
  type?: TagType;
  description?: string;
  /** Initial value (SPEC §7.4): BOOL 0/1, DINT, REAL, TIMER preset in ms. Set only when valid. */
  initial?: number;
  /** Where the value is written (`= 5`, `3s`), for messages. */
  valueSpan?: Span;
  /** Written in the `controller` block (SPEC §7.7): a controller-scope tag. */
  scope?: "controller";
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

/** An SFC routine (SPEC §4.5): `sfc name`, or the steps at the top of a file without a header. */
export interface SfcRoutineNode {
  kind: "sfc";
  /** Same object as `chart.header`; absent for a header-less first routine (named after the file). */
  name?: Name;
  chart: Chart;
  /** Span of the header line (absent for a header-less first routine). */
  span?: Span;
}

/** An ST routine (SPEC §4.5): `st name` and its body. */
export interface StRoutineNode {
  kind: "st";
  name: Name;
  /** Body lines after dedent, like an action (SPEC §4.3). Empty array = empty routine. */
  body: SourceText[];
  span: Span;
}

export type RoutineNode = SfcRoutineNode | StRoutineNode;

/** One line of an `io … end` block (SPEC §7.6): `name  address  ["description"]`. */
/** A routine named on a `uses` line (SPEC §4.5): in the program, but not in this file. */
export interface UsesEntry {
  name: Name;
  /** `(main)`: the program's main routine. */
  main: boolean;
}

export interface IoEntry {
  name: Name;
  /** In an `io` block inside the `controller` block (SPEC §7.7). */
  scope?: "controller";
  /** The Logix I/O path as written (`Local:1:I.Data.0`). */
  address: SourceText;
  description?: string;
  span: Span;
}

/**
 * A Logix I/O path for the `io` block (SPEC §7.6), checked loosely: a module part with at
 * least one `:` (`Local:1:I`, `Rack1:I`), then `.member`, `.bit` or `[index]` parts.
 */
export const IO_ADDRESS_RE = /^[A-Za-z_]\w*(?::\w+)+(?:\.\w+|\[\d+\])*$/;
/** An alias of a tag member in the `io` block (`ejections  Step_017.Count`, SPEC §7.6). */
export const TAG_PATH_RE = /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])+$/;

/** A bit address (`Local:1:I.Data.0`) ends with `.digits`: the tag is BOOL (SPEC §7.6). */
export function isBitAddress(address: string): boolean {
  return /\.\d+$/.test(address);
}

/** A whole file: one Program (SPEC §4.5). */
export interface ProgramNode {
  /** `program name` line. */
  header?: Name;
  /** `program name "Title"`: the Program description and the print title (SPEC §4.5). */
  title?: string;
  /** `course "…"` and `author "…"` header lines: for printing only, not exported (SPEC §4.5). */
  meta?: { course?: string; author?: string };
  /**
   * `uses INIT, MainRoutine (main)`: routines of the program that aren't in the file (SPEC §4.5).
   * `JSR`, `SFR` and `SFP` may name them; absent when there is none.
   */
  uses?: UsesEntry[];
  /**
   * `sfc tags s26, tr29` in the `controller` block (SPEC §7.7): steps and transitions whose
   * operand tags (and the step's action tags) are controller tags. Absent when there is none.
   */
  controllerElements?: Name[];
  /** Every line of every `io … end` block, in file order (SPEC §7.6); absent when there is none. */
  io?: IoEntry[];
  /** File order. The first one is the main routine. */
  routines: RoutineNode[];
  /** Every `tag` line of the file (also copied into each chart's `tagDecls`). */
  tagDecls: TagDecl[];
}

/** Every step name of the program (all SFC routines), as written. */
export function programStepNames(program: ProgramNode): string[] {
  return sfcCharts(program).flatMap((c) => allSteps(c).map((s) => s.name.text));
}

export function sfcCharts(program: ProgramNode): Chart[] {
  return program.routines.flatMap((r) => (r.kind === "sfc" ? [r.chart] : []));
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
