/**
 * Structure and chart rules (SPEC §5, §6, codes E2xx structure, E3xx, W3xx).
 * Never throws.
 *
 * Once E211-E218 and E220/E221 pass, these invariants hold (src/lower relies on them):
 * - a select always follows an actual step, and each of its legs starts and ends with
 *   an actual transition;
 * - a parallel always follows an actual transition, and each of its legs starts and
 *   ends with an actual step;
 * - after a select `end` comes an actual step (unless, at top level only, every leg jumps);
 * - after a parallel `end` comes an actual transition;
 * - inside a branch, a jump is always the last transition of a select leg, and every
 *   select nested in a branch has at least one leg that continues.
 */
import type { BranchNode, Chart, Element, Sequence, StepNode, TransitionNode } from "../model/ast.js";
import { allSteps, allTransitions, key, walk } from "../model/ast.js";
import { error, sortDiagnostics, warning, type Diagnostic, type Span } from "../model/diagnostics.js";
import { closest, NAME_RE } from "../parse/names.js";
import {
  allLegsJump,
  buildFlow,
  collectInfo,
  isJump,
  stepsByKey,
  type ElementInfo,
  type FlowGraph,
} from "./flow.js";

export function validate(chart: Chart): Diagnostic[] {
  const v = new Validator(chart);
  try {
    v.run();
  } catch (e) {
    v.diags.push(error("E000", { line: 1, col: 1 }, `internal validator error: ${String(e)}`));
  }
  return sortDiagnostics(v.diags);
}

function describe(el: Element): string {
  switch (el.kind) {
    case "step":
      return `step \`${el.name.text}\``;
    case "transition":
      return `transition \`${el.name.text}\``;
    default:
      return `a \`${el.kind}\` block (line ${el.span.line})`;
  }
}

/** Span to report "the end of" an element: the `end` line for branches. */
function endSpanOf(el: Element): Span {
  return el.kind === "select" || el.kind === "parallel" ? (el.endSpan ?? el.span) : el.span;
}

class Validator {
  readonly diags: Diagnostic[] = [];
  private readonly info: Map<Element, ElementInfo>;
  private flow!: FlowGraph;
  /** Steps that start a top-level chain. */
  private readonly heads: StepNode[] = [];

  constructor(private readonly chart: Chart) {
    this.info = collectInfo(chart);
  }

  run(): void {
    this.checkTop(this.chart.body);
    this.flow = buildFlow(this.chart);
    this.initialRules();
    this.names();
    this.conditions();
    this.jumps();
    this.reachability();
  }

  private err(code: string, span: Span, message: string, hint?: string): void {
    this.diags.push(error(code, span, message, hint));
  }

  // ---- alternation and branch shapes (§5) ---------------------------------------

  private checkTop(seq: Sequence): void {
    let prev: Element | undefined;
    let stopped = true;
    for (const el of seq) {
      if (stopped) this.chainStart(el, prev);
      else this.pair(prev!, el);
      if (stopped && el.kind === "step") this.heads.push(el);
      if (el.kind === "select" || el.kind === "parallel") this.checkBranch(el, false);
      stopped = isJump(el) || (el.kind === "select" && allLegsJump(el));
      prev = el;
    }
    if (prev && !stopped) this.chainEnd(prev);
  }

  private chainStart(el: Element, prev: Element | undefined): void {
    const why = prev
      ? isJump(prev)
        ? `the flow stops after the jump at line ${prev.span.line}`
        : `the flow stops after the \`select\` at line ${prev.span.line}, whose legs all jump`
      : undefined;
    if (el.kind === "transition") {
      this.err("E201", el.span, "a chain must start with a step; this transition has nothing before it",
        why ? `${why}; add a step before this transition` : "add a step before this transition");
    } else if (el.kind === "select") {
      this.err("E211", el.span, "`select` must follow a step", why ?? "put the step that chooses before `select`");
    } else if (el.kind === "parallel") {
      this.err("E215", el.span, "`parallel` must follow a transition", why ?? "add a step and a transition before `parallel`");
    }
  }

  /** Check two consecutive elements of a sequence where the flow continues. */
  private pair(prev: Element, el: Element): void {
    if (prev.kind === "select") {
      if (el.kind !== "step") {
        this.err("E214", el.span,
          `the \`select\` legs that don't jump need a step after \`end\` to merge into; found ${describe(el)}`,
          `add a step after the \`end\` at line ${endSpanOf(prev).line}`);
      }
      return;
    }
    if (prev.kind === "parallel") {
      if (el.kind !== "transition") {
        this.err("E218", el.span,
          `a transition must follow the \`end\` of a \`parallel\` block; found ${describe(el)}`,
          "add the convergence transition, e.g.  -- TRUE");
      }
      return;
    }
    if (el.kind === "parallel") {
      if (prev.kind !== "transition") {
        this.err("E215", el.span, `\`parallel\` must follow a transition; it follows ${describe(prev)}`,
          "add a transition before `parallel`");
      }
      return;
    }
    if (el.kind === "select") {
      if (prev.kind !== "step") {
        this.err("E211", el.span, `\`select\` must follow a step; it follows ${describe(prev)}`,
          "add the step that chooses before `select`");
      }
      return;
    }
    if (prev.kind === "step" && el.kind === "step") {
      const hint = prev.presetMs !== undefined && prev.name.text
        ? `add a transition between them, e.g.  -- ${prev.name.text}.DN`
        : "add a transition between them, e.g.  -- condition";
      this.err("E202", el.span,
        `two steps in a row: \`${prev.name.text}\` (line ${prev.span.line}) and \`${el.name.text}\``, hint);
      return;
    }
    if (prev.kind === "transition" && el.kind === "transition") {
      this.err("E203", el.span,
        `two transitions in a row: \`${prev.name.text}\` (line ${prev.span.line}) and \`${el.name.text}\``,
        "add a step between them");
    }
  }

  /** The last element of a top-level chain. */
  private chainEnd(last: Element): void {
    if (last.kind === "step") {
      this.diags.push(warning("W300", last.span, `step \`${last.name.text}\` has no transition after it: the chart stops there`));
    } else if (last.kind === "transition") {
      this.err("E308", last.span, `transition \`${last.name.text}\` leads nowhere: add \`-> step\` or a step after it`);
    } else if (last.kind === "select") {
      this.err("E214", endSpanOf(last), "the `select` legs that don't jump need a step after `end` to merge into");
    } else {
      this.err("E218", endSpanOf(last), "a transition must follow the `end` of a `parallel` block");
    }
  }

  private checkBranch(b: BranchNode, inBranch: boolean): void {
    if (b.legs.length < 2) {
      this.err("E207", b.span, `a branch needs at least 2 legs (separate them with \`|\`); this \`${b.kind}\` has ${b.legs.length}`);
    }
    b.legs.forEach((leg, i) => {
      if (leg.length === 0) {
        if (b.legs.length > 1) {
          const where = i === 0 ? `between \`${b.kind}\` and \`|\`` : i === b.legs.length - 1 ? "between `|` and `end`" : "between two `|`";
          this.err("E208", b.span, `empty leg ${where} (leg ${i + 1} of the \`${b.kind}\` at line ${b.span.line})`);
        }
        return;
      }
      this.checkLeg(b, leg, i);
    });
    if (b.kind === "select" && inBranch && allLegsJump(b)) {
      this.err("E221", b.span,
        "at least one leg of this `select` must continue (it is inside another branch, so the flow can't stop here)");
    }
  }

  private checkLeg(b: BranchNode, leg: Sequence, i: number): void {
    const n = i + 1;
    const first = leg[0]!;
    const last = leg[leg.length - 1]!;
    let startBad = false;
    if (b.kind === "select" && first.kind !== "transition") {
      startBad = true;
      this.err("E212", first.span, `each \`select\` leg must start with a transition (\`-- condition\`); leg ${n} starts with ${describe(first)}`);
    }
    if (b.kind === "parallel" && first.kind !== "step") {
      startBad = true;
      this.err("E216", first.span, `each \`parallel\` leg must start with a step; leg ${n} starts with ${describe(first)}`);
    }
    for (let j = 1; j < leg.length; j++) this.pair(leg[j - 1]!, leg[j]!);
    leg.forEach((el, j) => {
      if (el.kind === "select" || el.kind === "parallel") this.checkBranch(el, true);
      if (isJump(el) && !(b.kind === "select" && j === leg.length - 1)) {
        this.err("E220", el.span, "inside a branch, a jump must be the last transition of a `select` leg",
          b.kind === "parallel" ? "to loop inside a parallel leg, use a nested `select` whose leg jumps" : undefined);
      }
    });
    if (startBad && leg.length === 1) return;
    if (b.kind === "select" && last.kind !== "transition") {
      this.err("E213", endSpanOf(last), `each \`select\` leg must end with a transition; leg ${n} ends with ${describe(last)}`);
    }
    if (b.kind === "parallel" && last.kind !== "step") {
      this.err("E217", endSpanOf(last), `each \`parallel\` leg must end with a step; leg ${n} ends with ${describe(last)}`);
    }
  }

  // ---- initial step (E200, E300-E302) ------------------------------------------

  private initialRules(): void {
    const steps = allSteps(this.chart);
    if (steps.length === 0) {
      this.err("E200", { line: 1, col: 1 }, "the file has no steps", "start with  init name");
      return;
    }
    const inits = steps.filter((s) => s.initial);
    if (inits.length === 0) {
      this.err("E300", steps[0]!.span, "no initial step: mark one step with `init`",
        `e.g. write \`init ${steps[0]!.name.text || "name"}\` instead of \`step ...\``);
    }
    const firstInit = inits[0];
    for (const s of inits.slice(1)) {
      this.err("E301", s.span,
        `more than one initial step: \`${firstInit!.name.text}\` (line ${firstInit!.span.line}) and \`${s.name.text}\` (line ${s.span.line})`);
    }
    for (const s of inits) {
      if (this.info.get(s)?.parLeg) this.err("E302", s.span, "the initial step can't be inside a `parallel` block");
    }
  }

  // ---- names (E309) and conditions (E307) -----------------------------------------

  private names(): void {
    const seen = new Map<string, StepNode | TransitionNode>();
    for (const el of walk(this.chart.body)) {
      if (el.kind !== "step" && el.kind !== "transition") continue;
      const text = el.name.text;
      if (!text) continue;
      const k = key(text);
      const other = seen.get(k);
      if (other) {
        this.err("E309", el.name.span, `name \`${text}\` is already used by the ${other.kind} at line ${other.span.line}`);
      } else seen.set(k, el);
    }
  }

  private conditions(): void {
    for (const t of allTransitions(this.chart)) {
      if (t.condition.text === "") {
        this.err("E307", t.span, "transition has no condition; write `TRUE` for \"always\"");
      }
    }
  }

  // ---- jumps (E303-E305, W301) --------------------------------------------------

  private jumps(): void {
    const steps = stepsByKey(this.chart);
    const transitions = new Set(allTransitions(this.chart).map((t) => key(t.name.text)));
    const stepNames = [...steps.values()].map((s) => s.name.text);
    for (const t of allTransitions(this.chart)) {
      if (!t.jump || !NAME_RE.test(t.jump.text)) continue; // missing / invalid: reported by the parser
      const target = t.jump.text;
      const s = steps.get(key(target));
      if (!s) {
        if (transitions.has(key(target))) {
          this.err("E304", t.jump.span, `jump target \`${target}\` is a transition; jumps go to steps`);
        } else {
          const near = closest(target, stepNames);
          this.err("E303", t.jump.span,
            `jump target \`${target}\` doesn't exist${near ? `; did you mean \`${near}\`?` : ""}`);
        }
        continue;
      }
      const from = this.info.get(t)?.parLeg ?? null;
      const to = this.info.get(s)?.parLeg ?? null;
      if (from !== to) {
        this.err("E305", t.jump.span, "a jump can't enter or leave a `parallel` block",
          "the source and the target must be in the same parallel leg, or both outside any parallel block");
        continue;
      }
      if (this.textualNext(t) === s) {
        const incoming = (this.flow.pred.get(s) ?? []).filter((p) => p.kind === "transition");
        if (incoming.length === 1 && incoming[0] === t) {
          this.diags.push(warning("W301", t.jump.span, `jump to \`${s.name.text}\` is not needed: it is the next step anyway`,
            `remove \`-> ${t.jump.text}\``));
        }
      }
    }
  }

  /** The element the flow would reach if the jump were removed. */
  private textualNext(t: TransitionNode): Element | undefined {
    const i = this.info.get(t);
    if (!i) return undefined;
    const next = i.seq[i.index + 1];
    if (next) return next;
    const p = i.parent;
    if (p && p.kind === "select" && i.leg === p.legs.length - 1) {
      const pi = this.info.get(p);
      return pi?.seq[pi.index + 1];
    }
    return undefined;
  }

  // ---- reachability (E306) -----------------------------------------------------

  private reachability(): void {
    const inits = allSteps(this.chart).filter((s) => s.initial);
    if (inits.length === 0) return;
    const seen = new Set<Element>(inits);
    const queue: Element[] = [...inits];
    while (queue.length > 0) {
      const el = queue.shift()!;
      for (const n of this.flow.succ.get(el) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    for (const h of this.heads) {
      if (!seen.has(h)) {
        this.err("E306", h.span, `step \`${h.name.text}\` can never become active (no jump or flow reaches it)`,
          `mark it \`init\`, or add a jump \`-> ${h.name.text}\` from another transition`);
      }
    }
  }
}
