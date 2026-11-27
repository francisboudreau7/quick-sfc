/**
 * Simulation (Phase 4e, docs/mockups/sim): runs a compiled program like the PLC, scan by scan.
 * Logix defaults: each pass of an SFC routine runs its active steps' actions, then fires the
 * true transitions once (a step activated in this pass waits for the next one); a step that
 * ends resets the outputs its actions wrote with `[:=]`. The main routine runs every scan; the
 * others when called. Minimal ST (src/st/exec.ts). Pure: no DOM, no timers (the app calls scan()).
 */
import type { CompileResult } from "../compile.js";
import type { TagType } from "../model/ast.js";
import type { GAction, Graph, GraphId, GTransition } from "../model/graph.js";
import { evaluate, parseExpr, truthy, type Env, type Expr, type Value } from "../st/expr.js";
import { parseStatements, targets, type Stmt } from "../st/exec.js";

export interface SimTag {
  name: string;
  type: TagType;
  /** Read by the program, written by nothing: the user sets it. */
  input: boolean;
  value: Value;
  description?: string;
}

export interface SimStep {
  routine: string;
  id: GraphId;
  name: string;
  active: boolean;
  /** Time active, ms (`.T`). */
  t: number;
  presetMs: number;
  count: number;
}

export interface TraceEvent {
  scan: number;
  /** ms */
  time: number;
  kind: "start" | "fire" | "hand" | "input" | "note";
  text: string;
}

/** A part of a condition as the diagram colors it (offsets in the condition text). */
export interface CondPart {
  from: number;
  to: number;
  value: boolean;
  /** An input tag: the diagram draws it as a button that toggles it. */
  input?: string;
  /** A comparison: the value of its tag (`count=7`). */
  label?: string;
}

interface StepState {
  active: boolean;
  /** Activated in the last pass: its first scan comes next. */
  fresh: boolean;
  fs: boolean;
  t: number;
  count: number;
  tickScan: number;
}

interface Routine {
  name: string;
  kind: "sfc" | "st";
  graph?: Graph;
  st?: Stmt[];
  started: boolean;
  steps: Map<GraphId, StepState>;
  actions: Map<GAction, Stmt[]>;
  conds: Map<GraphId, Expr>;
  preds: Map<GraphId, GraphId[]>;
  succs: Map<GraphId, GraphId[]>;
  /** Stored (S) actions running: action → the step that started it. */
  stored: Map<GAction, string>;
  /** Actions that ran in the last pass (an L / P action that stops resets its `[:=]` outputs). */
  running: Set<GAction>;
}

const MAX_TRACE = 400;

export class Simulator {
  scanMs = 100;
  time = 0;
  scans = 0;
  trace: TraceEvent[] = [];
  private tags = new Map<string, SimTag>();
  private routines: Routine[] = [];
  private byName = new Map<string, Routine>();
  private stepByName = new Map<string, { r: Routine; id: GraphId; presetMs: number; name: string }>();
  private forced = new Set<string>();
  private pulses = new Set<string>();
  private noted = new Set<string>();
  private callDepth = 0;
  private outsideMain = false;

  constructor(private readonly result: CompileResult) {
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.scans = 0;
    this.trace = [];
    this.forced.clear();
    this.pulses.clear();
    this.noted.clear();
    this.routines = [];
    this.byName.clear();
    this.stepByName.clear();
    const written = new Set<string>();
    for (const cr of this.result.routines) {
      const r: Routine = { name: cr.name, kind: cr.kind, started: false, steps: new Map(), actions: new Map(), conds: new Map(), preds: new Map(), succs: new Map(), stored: new Map(), running: new Set() };
      if (cr.kind === "st" && cr.node.kind === "st") {
        r.st = parseStatements(cr.node.body.map((l) => l.text), cr.node.body[0]?.span.line ?? 1);
        targets(r.st, written);
      } else if (cr.graph) {
        const g = cr.graph;
        r.graph = g;
        for (const s of g.steps) {
          r.steps.set(s.id, { active: false, fresh: false, fs: false, t: 0, count: 0, tickScan: -1 });
          this.stepByName.set(s.name.toLowerCase(), { r, id: s.id, presetMs: s.presetMs, name: s.name });
          for (const a of s.actions) {
            const stmts = parseStatements(a.lines, a.node.lines?.[0]?.span.line ?? s.node.span.line);
            r.actions.set(a, stmts);
            targets(stmts, written);
          }
        }
        for (const t of g.transitions) {
          r.conds.set(t.id, parseExpr(t.condition));
          r.preds.set(t.id, preds(g, t.id));
          r.succs.set(t.id, succs(g, t.id));
        }
      }
      this.routines.push(r);
      this.byName.set(r.name.toLowerCase(), r);
    }
    this.tags.clear();
    for (const t of this.result.tags) {
      if (t.type === "SFC_STEP" || t.type === "SFC_ACTION") continue;
      const v: Value = t.type === "BOOL" ? !!(t.initial ?? 0) : (t.initial ?? 0);
      const tag: SimTag = { name: t.name, type: t.type, input: !written.has(t.name.toLowerCase()), value: v };
      if (t.description) tag.description = t.description;
      this.tags.set(t.name.toLowerCase(), tag);
    }
    this.outsideMain = !!this.result.program.uses?.some((u) => u.main);
  }

  // ---- reading ----------------------------------------------------------------------------

  tagList(): SimTag[] {
    return [...this.tags.values()];
  }

  stepList(): SimStep[] {
    const out: SimStep[] = [];
    for (const r of this.routines) {
      if (!r.graph) continue;
      for (const s of r.graph.steps) {
        const st = r.steps.get(s.id)!;
        out.push({ routine: r.name, id: s.id, name: s.name, active: st.active, t: st.t, presetMs: s.presetMs, count: st.count });
      }
    }
    return out;
  }

  /** Whether the transition can fire now (every step before it active) and its condition's value. */
  transition(routine: string, id: GraphId): { enabled: boolean; value: boolean } {
    const r = this.byName.get(routine.toLowerCase());
    if (!r?.graph) return { enabled: false, value: false };
    const enabled = (r.preds.get(id) ?? []).every((p) => r.steps.get(p)?.active);
    const c = r.conds.get(id);
    return { enabled, value: c ? truthy(evaluate(c, this.env(r, id))) : false };
  }

  /** The parts of a transition's condition (its text in the diagram), each true or false. */
  conditionParts(routine: string, id: GraphId): CondPart[] {
    const r = this.byName.get(routine.toLowerCase());
    const e = r?.conds.get(id);
    if (!r || !e) return [];
    const env = this.env(r, id);
    const out: CondPart[] = [];
    const walk = (x: Expr): void => {
      switch (x.k) {
        case "var": {
          const p: CondPart = { from: x.from, to: x.to, value: truthy(env.get(x.path)) };
          const tag = this.tags.get(x.path);
          if (tag?.input && tag.type === "BOOL") p.input = tag.name;
          out.push(p);
          return;
        }
        case "after":
          out.push({ from: x.from, to: x.to, value: truthy(evaluate(x, env)) });
          return;
        case "cmp": {
          const p: CondPart = { from: x.from, to: x.to, value: truthy(evaluate(x, env)) };
          const v = x.a.k === "var" ? x.a : x.b.k === "var" ? x.b : undefined;
          if (v) p.label = `${v.text}=${fmt(env.get(v.path))}`;
          out.push(p);
          return;
        }
        case "not":
          walk(x.a);
          return;
        case "bin":
          if (x.op === "AND" || x.op === "OR" || x.op === "XOR") {
            walk(x.a);
            walk(x.b);
          }
          return;
        default:
      }
    };
    walk(e);
    return out;
  }

  // ---- acting -----------------------------------------------------------------------------

  setTag(name: string, value: Value): void {
    const t = this.tags.get(name.toLowerCase());
    if (!t) return;
    t.value = coerce(t.type, value);
    this.log("input", `you set ${t.name} = ${fmt(t.value)}`);
  }

  toggle(name: string): void {
    const t = this.tags.get(name.toLowerCase());
    if (t) this.setTag(t.name, t.type === "BOOL" ? !t.value : t.value);
  }

  /** 1 for one scan (a push button). */
  pulse(name: string): void {
    const t = this.tags.get(name.toLowerCase());
    if (!t || t.type !== "BOOL") return;
    t.value = true;
    this.pulses.add(name.toLowerCase());
    this.log("input", `you pressed ${t.name} (one scan)`);
  }

  /** Fires a transition on the next scan, whatever its condition. Returns why it can't, if it can't. */
  fire(routine: string, id: GraphId): string | undefined {
    const r = this.byName.get(routine.toLowerCase());
    const t = r?.graph?.transitions.find((x) => x.id === id);
    if (!r || !t) return "no such transition";
    const missing = (r.preds.get(id) ?? []).filter((p) => !r.steps.get(p)?.active);
    if (missing.length) {
      const names = missing.map((p) => r.graph!.steps.find((s) => s.id === p)!.name);
      return `${names.join(" and ")} must be active`;
    }
    this.forced.add(`${r.name}/${id}`);
    return undefined;
  }

  /** One scan. */
  scan(): void {
    this.scans++;
    const main = this.routines[0];
    if (!main) return;
    if (this.outsideMain) {
      // the main routine is not in the file: every SFC routine runs each scan
      for (const r of this.routines) if (r.kind === "sfc") this.run(r);
    } else this.run(main);
    this.time += this.scanMs;
    for (const p of this.pulses) {
      const t = this.tags.get(p);
      if (t) t.value = false;
    }
    this.pulses.clear();
  }

  // ---- running ----------------------------------------------------------------------------

  private run(r: Routine): void {
    if (this.callDepth > 8) return;
    this.callDepth++;
    try {
      if (r.kind === "st") this.exec(r.st ?? [], r, undefined);
      else this.pass(r);
    } finally {
      this.callDepth--;
    }
  }

  private pass(r: Routine): void {
    const g = r.graph!;
    if (!r.started) {
      r.started = true;
      for (const s of g.steps) if (s.initial) this.activate(r, s.id);
      this.log("start", `${r.name} starts at ${g.steps.filter((s) => s.initial).map((s) => s.name).join(", ")}`);
    }
    // 1. the active steps: timers, then their actions
    for (const s of g.steps) {
      const st = r.steps.get(s.id)!;
      if (!st.active) continue;
      if (st.tickScan !== this.scans) {
        if (st.fresh) {
          st.fresh = false;
          st.fs = true;
          st.t = 0;
        } else {
          st.fs = false;
          st.t += this.scanMs;
        }
        st.tickScan = this.scans;
      }
      for (const a of s.actions) {
        const run =
          a.qualifier === "N" ||
          a.qualifier === "R" ||
          (a.qualifier === "P" && st.fs) ||
          (a.qualifier === "L" && st.t < (a.timeMs ?? 0)) ||
          (a.qualifier === "D" && st.t >= (a.timeMs ?? 0));
        if (a.qualifier === "S") {
          if (!r.stored.has(a)) r.stored.set(a, s.name);
          continue;
        }
        if (!run) {
          // an action that stops while its step stays active (L time up, P after its scan)
          if (r.running.delete(a)) for (const t of nonRetentive(r.actions.get(a) ?? [])) this.write(t, false);
          continue;
        }
        r.running.add(a);
        if (a.qualifier === "R") this.resetStored(r.actions.get(a) ?? []);
        this.exec(r.actions.get(a) ?? [], r, s.id);
      }
    }
    // 2. the stored actions, still running after their step
    for (const [a] of r.stored) this.exec(r.actions.get(a) ?? [], r, undefined);
    // 3. the transitions, once (a step activated now waits for the next pass)
    const touched = new Set<GraphId>();
    for (const t of g.transitions) {
      const ps = r.preds.get(t.id)!;
      if (!ps.length || ps.some((p) => touched.has(p) || !r.steps.get(p)!.active)) continue;
      const key = `${r.name}/${t.id}`;
      const byHand = this.forced.delete(key);
      if (!byHand && !truthy(evaluate(r.conds.get(t.id)!, this.env(r, t.id)))) continue;
      const to = r.succs.get(t.id)!;
      for (const p of ps) {
        this.deactivate(r, p);
        touched.add(p);
      }
      for (const n of to) {
        this.activate(r, n);
        touched.add(n);
      }
      const names = (ids: GraphId[]) => ids.map((id) => g.steps.find((s) => s.id === id)!.name).join(", ");
      this.log(byHand ? "hand" : "fire", `${byHand ? "by hand: " : ""}-- ${shown(t)} fires: ${names(ps)} → ${names(to)}`);
    }
  }

  private activate(r: Routine, id: GraphId): void {
    const st = r.steps.get(id)!;
    st.active = true;
    st.fresh = true;
    st.count++;
  }

  /** The step's last scan: outputs written with `[:=]` by its actions go back to 0. */
  private deactivate(r: Routine, id: GraphId): void {
    const st = r.steps.get(id)!;
    st.active = false;
    st.fs = false;
    const s = r.graph!.steps.find((x) => x.id === id)!;
    for (const a of s.actions) {
      r.running.delete(a);
      if (a.qualifier === "S") continue;
      for (const stmt of nonRetentive(r.actions.get(a) ?? [])) this.write(stmt, false);
    }
  }

  private resetStored(rStmts: Stmt[]): void {
    const tagsR = targets(rStmts);
    for (const r of this.routines) {
      for (const [a] of [...r.stored]) {
        const mine = targets(r.actions.get(a) ?? []);
        if ([...mine].some((t) => tagsR.has(t))) {
          r.stored.delete(a);
          for (const s of nonRetentive(r.actions.get(a) ?? [])) this.write(s, false);
        }
      }
    }
  }

  private exec(stmts: readonly Stmt[], r: Routine, stepId: GraphId | undefined): void {
    for (const s of stmts) {
      switch (s.k) {
        case "assign":
          this.write(s.target, evaluate(s.value, this.env(r, undefined)));
          break;
        case "if": {
          const env = this.env(r, undefined);
          const b = s.branches.find((x) => truthy(evaluate(x.cond, env)));
          this.exec(b ? b.body : s.otherwise, r, stepId);
          break;
        }
        case "call": {
          const target = this.byName.get(s.routine.toLowerCase());
          if (target) this.run(target);
          else this.note(`call ${s.routine}`, `${s.routine} is not in this file: the call is skipped`);
          break;
        }
        case "skip":
          if (s.text.trim()) this.note(s.text, `line ${s.line}: \`${s.text.trim()}\` is not simulated yet (skipped)`);
          break;
      }
    }
  }

  private write(target: string, value: Value): void {
    const tag = this.tags.get(target);
    if (tag) {
      tag.value = coerce(tag.type, value);
      return;
    }
    const dot = target.indexOf(".");
    if (dot > 0) {
      const step = this.stepByName.get(target.slice(0, dot));
      const member = target.slice(dot + 1);
      if (step && member === "count") {
        step.r.steps.get(step.id)!.count = Math.trunc(Number(value));
        return;
      }
    }
    this.note(`write ${target}`, `\`${target}\` can't be written in the simulation (skipped)`);
  }

  private env(r: Routine, transitionId: GraphId | undefined): Env {
    const afterStep = transitionId ? r.graph?.transitions.find((t) => t.id === transitionId)?.afterStep : undefined;
    return {
      get: (path) => {
        const tag = this.tags.get(path);
        if (tag) return tag.value;
        const dot = path.indexOf(".");
        if (dot > 0) {
          const step = this.stepByName.get(path.slice(0, dot));
          if (step) {
            const st = step.r.steps.get(step.id)!;
            switch (path.slice(dot + 1)) {
              case "x":
                return st.active;
              case "fs":
                return st.active && st.fs;
              case "t":
                return st.t;
              case "dn":
                return st.active && st.t >= step.presetMs;
              case "pre":
                return step.presetMs;
              case "count":
                return st.count;
              default:
                return 0;
            }
          }
        }
        return false;
      },
      after: (ms) => {
        const s = afterStep ? this.stepByName.get(afterStep.toLowerCase()) : undefined;
        const st = s?.r.steps.get(s.id);
        return !!st?.active && st.t >= ms;
      },
    };
  }

  private note(key: string, text: string): void {
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.log("note", text);
  }

  private log(kind: TraceEvent["kind"], text: string): void {
    this.trace.push({ scan: this.scans, time: this.time, kind, text });
    if (this.trace.length > MAX_TRACE) this.trace.splice(0, this.trace.length - MAX_TRACE);
  }
}

function coerce(type: TagType, v: Value): Value {
  if (type === "BOOL") return truthy(v);
  const n = typeof v === "boolean" ? (v ? 1 : 0) : v;
  return type === "DINT" ? Math.trunc(n) : n;
}

function fmt(v: Value): string {
  if (typeof v === "boolean") return v ? "1" : "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** A transition as the trace names it: its condition, or `else` for the else leg. */
function shown(t: GTransition): string {
  return t.else ? "else" : t.condition;
}

/** Targets of the `[:=]` assignments (reset when the step ends). */
function nonRetentive(stmts: readonly Stmt[], out: string[] = []): string[] {
  for (const s of stmts) {
    if (s.k === "assign" && !s.retentive) out.push(s.target);
    if (s.k === "if") {
      for (const b of s.branches) nonRetentive(b.body, out);
      nonRetentive(s.otherwise, out);
    }
  }
  return out;
}

// ---- graph: the steps before / after a transition (link patterns: src/model/graph.ts) -------

function preds(g: Graph, tid: GraphId): GraphId[] {
  const isStep = (id: GraphId) => g.steps.some((s) => s.id === id);
  const out: GraphId[] = [];
  for (const l of g.links) {
    if (l.to !== tid) continue;
    if (isStep(l.from)) out.push(l.from);
    else {
      const bid = l.from.includes(".") ? l.from.slice(0, l.from.indexOf(".")) : l.from;
      const b = g.branches.find((x) => x.id === bid);
      if (!b) continue;
      if (b.type === "selection" && b.flow === "diverge") {
        for (const l2 of g.links) if (l2.to === b.id && isStep(l2.from)) out.push(l2.from);
      } else if (b.type === "simultaneous" && b.flow === "converge") {
        for (const leg of b.legs) for (const l2 of g.links) if (l2.to === leg.id && isStep(l2.from)) out.push(l2.from);
      }
    }
  }
  return out;
}

function succs(g: Graph, tid: GraphId): GraphId[] {
  const isStep = (id: GraphId) => g.steps.some((s) => s.id === id);
  const out: GraphId[] = [];
  for (const l of g.links) {
    if (l.from !== tid) continue;
    if (isStep(l.to)) out.push(l.to);
    else {
      const bid = l.to.includes(".") ? l.to.slice(0, l.to.indexOf(".")) : l.to;
      const b = g.branches.find((x) => x.id === bid);
      if (!b) continue;
      if (b.type === "simultaneous" && b.flow === "diverge") {
        for (const leg of b.legs) for (const l2 of g.links) if (l2.from === leg.id && isStep(l2.to)) out.push(l2.to);
      } else if (b.type === "selection" && b.flow === "converge") {
        for (const l2 of g.links) if (l2.from === b.id && isStep(l2.to)) out.push(l2.to);
      }
    }
  }
  return out;
}
