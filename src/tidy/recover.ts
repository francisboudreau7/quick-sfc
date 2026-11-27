/**
 * Recovers a qSFC structure (chains, select / parallel blocks, jumps) from a Studio SFC chart,
 * as qSFC source text with synthetic names (`s12` = the step with ID 12, `t39` = transition 39,
 * every condition TRUE). Tidy then compiles it with the normal pipeline and checks that the
 * links come out exactly as in the original (src/tidy/index.ts).
 *
 * The search places elements depth first, the way the qSFC tree is walked (file order), and
 * backtracks over the few real choices: after a transition, does the flow go on to the next
 * step, does it end the select leg, or is it a jump?
 *  - "strict" order: steps and transitions must come in document order (qSFC's own export
 *    numbers them in file order), which pins down almost every choice;
 *  - "free" order (charts drawn in Studio, numbered in creation order): any order, and a jump
 *    only where the flow can't go on.
 * Among the structures that fit, the one with the lowest score() wins.
 */
import type { SfcChart } from "./read.js";

type End =
  | { kind: "stop" }
  | { kind: "jump" }
  /** Last transition of a select leg wired straight to the step after the block. */
  | { kind: "direct"; step: string }
  /** Last transition of a select leg wired to a leg of selection converge `conv`. */
  | { kind: "conv"; conv: string }
  /** Last step of a parallel leg wired to a leg of simultaneous converge `conv`. */
  | { kind: "pend"; conv: string };

type Ctx = "top" | "sel" | "par";

type Elem =
  | { k: "step"; id: string }
  | { k: "trans"; id: string; jump?: string }
  /** `direct`: the one continuing leg is wired straight to the step after `end` (no converge). */
  | { k: "select"; legs: Elem[][]; direct?: boolean }
  | { k: "parallel"; legs: Elem[][] };

type Cont = (end: End) => boolean;

export interface Candidate {
  source: string;
  /** See score(): lower is better. */
  score: number[];
}

export interface Recovery {
  /** Best first. Empty when no structure fits. */
  candidates: Candidate[];
  /** Why nothing fits (the reason met deepest in the search). */
  reason?: string;
}

const NODE_BUDGET = 200_000;
const MAX_CANDIDATES = 40;

export const stepName = (id: string): string => (/^\d+$/.test(id) ? `s${id}` : `s_${id.replace(/\W/g, "_")}`);
export const transName = (id: string): string => (/^\d+$/.test(id) ? `t${id}` : `t_${id.replace(/\W/g, "_")}`);

interface Index {
  out: Map<string, string[]>;
  inn: Map<string, string[]>;
}

export function indexLinks(chart: SfcChart): Index {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const l of chart.links) {
    (out.get(l.from) ?? out.set(l.from, []).get(l.from)!).push(l.to);
    (inn.get(l.to) ?? inn.set(l.to, []).get(l.to)!).push(l.from);
  }
  return { out, inn };
}

/** Plain-sentence name of an element for messages. */
export function describeId(chart: SfcChart, id: string): string {
  const n = chart.nodes.get(id);
  if (n) return `${n.kind === "transition" ? "transition" : n.kind === "stop" ? "Stop" : "step"} ${n.operand}`;
  const b = chart.branches.get(id) ?? chart.branches.get(chart.legOf.get(id) ?? "");
  if (b) {
    const what = `${b.type === "selection" ? "selection" : "parallel"} ${b.flow} (ID ${b.id})`;
    return b.id === id ? `the ${what}` : `a leg of the ${what}`;
  }
  return `element ${id}`;
}

type Kind = "step" | "stop" | "transition" | "selD" | "selC" | "simD" | "simC" | "selDleg" | "selCleg" | "simDleg" | "simCleg";

function kindOf(chart: SfcChart, id: string): Kind | undefined {
  const n = chart.nodes.get(id);
  if (n) return n.kind;
  const own = chart.branches.get(id);
  const b = own ?? chart.branches.get(chart.legOf.get(id) ?? "");
  if (!b) return undefined;
  const base = `${b.type === "selection" ? "sel" : "sim"}${b.flow === "diverge" ? "D" : "C"}`;
  return (own ? base : `${base}leg`) as Kind;
}

const ALLOWED = new Set([
  "step>transition",
  "step>selD",
  "step>simCleg",
  "transition>step",
  "transition>stop",
  "transition>simD",
  "transition>selCleg",
  "selDleg>transition",
  "simDleg>step",
  "simDleg>selCleg",
  "selC>step",
  "selC>stop",
  "simC>transition",
]);

/** Shape checks that need no search. Returns a plain sentence, or undefined when the shape is fine. */
export function checkShape(chart: SfcChart): string | undefined {
  const { out, inn } = indexLinks(chart);
  const steps = [...chart.nodes.values()].filter((n) => n.kind !== "transition");
  if (steps.length === 0) return "the chart has no steps";
  const initial = steps.filter((s) => s.initial);
  if (initial.length !== 1) return initial.length ? `the chart has ${initial.length} initial steps` : "the chart has no initial step";
  if (initial[0]!.kind !== "step") return "the initial step is a Stop element";
  const seen = new Set<string>();
  for (const l of chart.links) {
    const a = kindOf(chart, l.from);
    const b = kindOf(chart, l.to);
    if (!a || !b) return `a wire points to an element that does not exist (ID ${a ? l.to : l.from})`;
    const k = `${l.from}>${l.to}`;
    if (seen.has(k)) return `the wire from ${describeId(chart, l.from)} to ${describeId(chart, l.to)} is there twice`;
    seen.add(k);
    if (!ALLOWED.has(`${a}>${b}`)) {
      return `a wire goes from ${describeId(chart, l.from)} to ${describeId(chart, l.to)}, which an SFC can't do`;
    }
  }
  const nOut = (id: string) => out.get(id)?.length ?? 0;
  const nIn = (id: string) => inn.get(id)?.length ?? 0;
  for (const n of chart.nodes.values()) {
    const d = describeId(chart, n.id);
    if (n.kind === "transition") {
      if (nIn(n.id) !== 1) return nIn(n.id) ? `${d} has several incoming wires` : `nothing leads to ${d}`;
      if (nOut(n.id) !== 1) return nOut(n.id) ? `${d} has several outgoing wires` : `${d} leads nowhere`;
    } else {
      if (n.kind === "stop" && nOut(n.id) > 0) return `${d} has an outgoing wire`;
      if (nOut(n.id) > 1) return `${d} has several outgoing wires`;
      if (nIn(n.id) > 1) return `${d} has several incoming wires without a selection converge in front of it`;
    }
  }
  for (const b of chart.branches.values()) {
    const d = describeId(chart, b.id);
    if (b.legs.length < 2) return `${d} has fewer than two legs`;
    if (b.flow === "diverge") {
      if (nIn(b.id) !== 1) return nIn(b.id) ? `${d} has several incoming wires` : `nothing leads to ${d}`;
      for (const leg of b.legs) if (nOut(leg) !== 1) return `a leg of ${d.replace(/^the /, "the ")} ${nOut(leg) ? "has several wires" : "leads nowhere"}`;
    } else {
      if (nOut(b.id) !== 1) return nOut(b.id) ? `${d} has several outgoing wires` : `${d} leads nowhere`;
      for (const leg of b.legs) if (nIn(leg) !== 1) return `a leg of ${d} ${nIn(leg) ? "has several incoming wires" : "is not connected"}`;
    }
  }
  return undefined;
}

/** Runs the search. Precondition: checkShape() passed. */
export function recover(chart: SfcChart, mode: "strict" | "free"): Recovery {
  const { out } = indexLinks(chart);
  const strict = mode === "strict";
  const placed = new Set<string>();
  const stepOrder = chart.stepOrder;
  const transOrder = chart.transOrder;
  const initialId = stepOrder.find((id) => chart.nodes.get(id)!.initial)!;
  const succ = (id: string): string => out.get(id)![0]!;
  const branchOfLeg = (leg: string) => chart.branches.get(chart.legOf.get(leg)!)!;
  const firstUnplaced = (order: string[]): string | undefined => order.find((id) => !placed.has(id));

  let nodes = 0;
  let exhausted = false;
  let best: { reason: string; depth: number } | undefined;
  const fail = (reason: string): false => {
    if (!best || placed.size > best.depth) best = { reason, depth: placed.size };
    return false;
  };
  const tick = (): boolean => {
    if (++nodes > NODE_BUDGET) exhausted = true;
    return exhausted;
  };
  const found: Candidate[] = [];
  const seenSources = new Set<string>();
  const chains: Elem[][] = [];

  const place = (id: string, k: () => boolean): boolean => {
    placed.add(id);
    const r = k();
    placed.delete(id);
    return r;
  };

  const placeStep = (ctx: Ctx, id: string, seq: Elem[], k: Cont): boolean => {
    if (tick()) return true;
    if (placed.has(id)) return fail(`${describeId(chart, id)} is reached twice`);
    if (strict && firstUnplaced(stepOrder) !== id) return false;
    return place(id, () => {
      seq.push({ k: "step", id });
      const next = out.get(id)?.[0];
      let r: boolean;
      if (next === undefined) {
        r = ctx === "top" ? k({ kind: "stop" }) : fail(`${describeId(chart, id)} ends a branch leg without a transition`);
      } else if (chart.nodes.get(next)?.kind === "transition") {
        r = placeTrans(ctx, next, seq, k);
      } else if (chart.branches.has(next)) {
        r = placeSelect(ctx, next, seq, k);
      } else {
        // a leg of a simultaneous converge: this step ends a parallel leg
        const conv = chart.legOf.get(next)!;
        r = ctx === "par" ? k({ kind: "pend", conv }) : fail(`${describeId(chart, id)} joins a parallel converge from outside its branch`);
      }
      seq.pop();
      return r;
    });
  };

  const placeTrans = (ctx: Ctx, id: string, seq: Elem[], k: Cont): boolean => {
    if (tick()) return true;
    if (strict && firstUnplaced(transOrder) !== id) return false;
    return place(id, () => {
      const el: Elem = { k: "trans", id };
      seq.push(el);
      const r = afterTrans(ctx, el, seq, k);
      seq.pop();
      return r;
    });
  };

  const afterTrans = (ctx: Ctx, el: Elem & { k: "trans" }, seq: Elem[], k: Cont): boolean => {
    const next = succ(el.id);
    if (chart.branches.has(next)) return placeParallel(ctx, next, seq, k);
    let target = next;
    let conv: string | undefined;
    if (!chart.nodes.has(next)) {
      conv = chart.legOf.get(next)!;
      target = succ(conv);
    }
    const jump = (): boolean => {
      if (ctx === "par") return fail(`a jump from ${describeId(chart, el.id)} leaves or enters a parallel branch`);
      el.jump = target;
      const r = k({ kind: "jump" });
      delete el.jump;
      return r;
    };
    const inFlow = (): boolean => (placed.has(target) || (conv !== undefined && placed.has(conv)) ? false : placeStep(ctx, target, seq, k));
    const options: Array<() => boolean> = [];
    if (ctx === "sel") options.push(() => k(conv !== undefined ? { kind: "conv", conv } : { kind: "direct", step: target }));
    const canFlow = !placed.has(target) && !(conv !== undefined && placed.has(conv));
    if (strict) options.push(jump, inFlow);
    else {
      // charts drawn in Studio: a jump only where the flow can't go on
      options.push(inFlow);
      if (!canFlow || conv !== undefined) options.push(jump);
    }
    for (const o of options) if (o()) return true;
    return false;
  };

  const placeSelect = (ctx: Ctx, id: string, seq: Elem[], k: Cont): boolean => {
    const b = chart.branches.get(id)!;
    return place(id, () => {
      const block: Elem & { k: "select" } = { k: "select", legs: [] };
      seq.push(block);
      const ends: End[] = [];
      const leg = (i: number): boolean => {
        if (i === b.legs.length) return combine();
        const first = succ(b.legs[i]!);
        const legSeq: Elem[] = [];
        block.legs.push(legSeq);
        const r = placeTrans("sel", first, legSeq, (end) => {
          ends.push(end);
          const r2 = leg(i + 1);
          ends.pop();
          return r2;
        });
        block.legs.pop();
        return r;
      };
      const combine = (): boolean => {
        const cont = ends.filter((e) => e.kind !== "jump");
        if (cont.length === 0) {
          if (ctx !== "top") return fail(`every leg of ${describeId(chart, id)} jumps away, inside another branch`);
          return k({ kind: "jump" });
        }
        const convs = new Set(cont.map((e) => (e.kind === "conv" ? e.conv : "")));
        if (convs.size === 1 && !convs.has("")) {
          const conv = [...convs][0]!;
          if (placed.has(conv)) return fail(`a selection converge (ID ${conv}) joins legs from two different blocks`);
          return place(conv, () => placeStep(ctx, succ(conv), seq, k));
        }
        if (cont.length === 1 && cont[0]!.kind === "direct") {
          block.direct = true;
          const r = placeStep(ctx, cont[0]!.step, seq, k);
          delete block.direct;
          return r;
        }
        return fail(`the legs of ${describeId(chart, id)} meet in different places`);
      };
      const r = leg(0);
      seq.pop();
      return r;
    });
  };

  const placeParallel = (ctx: Ctx, id: string, seq: Elem[], k: Cont): boolean => {
    const b = chart.branches.get(id)!;
    return place(id, () => {
      const block: Elem & { k: "parallel" } = { k: "parallel", legs: [] };
      seq.push(block);
      const ends: string[] = [];
      const leg = (i: number): boolean => {
        if (i === b.legs.length) {
          const conv = ends[0]!;
          if (ends.some((c) => c !== conv)) return fail(`the legs of ${describeId(chart, id)} end in different converges`);
          if (placed.has(conv)) return fail(`a parallel converge (ID ${conv}) joins legs from two different blocks`);
          if (chart.branches.get(conv)!.legs.length !== b.legs.length) {
            return fail(`${describeId(chart, id)} and its converge have different numbers of legs`);
          }
          return place(conv, () => placeTrans(ctx, succ(conv), seq, k));
        }
        let first = succ(b.legs[i]!);
        // a leg whose first step is also reached by jumps: an automatic convergence in between
        const conv = chart.legOf.get(first);
        if (conv !== undefined) {
          if (placed.has(conv)) return fail(`a selection converge (ID ${conv}) joins legs from two different blocks`);
          first = succ(conv);
        }
        const legSeq: Elem[] = [];
        block.legs.push(legSeq);
        const r = placeStep("par", first, legSeq, (end) => {
          if (end.kind !== "pend") return false;
          ends.push(end.conv);
          const r2 = leg(i + 1);
          ends.pop();
          return r2;
        });
        block.legs.pop();
        return r;
      };
      const r = leg(0);
      seq.pop();
      return r;
    });
  };

  const pickHead = (): string | undefined => {
    if (strict) return firstUnplaced(stepOrder);
    if (chains.length === 0) return initialId;
    return firstUnplaced(stepOrder);
  };

  const leaf = (): boolean => {
    const source = serialize(chains, initialId);
    if (!seenSources.has(source)) {
      seenSources.add(source);
      found.push({ source, score: score(chains) });
    }
    return found.length >= 5000;
  };

  const runChains = (): boolean => {
    const head = pickHead();
    if (head === undefined) return leaf();
    if (chains.length === 0 && !strict && head !== initialId) return false;
    const chain: Elem[] = [];
    chains.push(chain);
    const r = placeStep("top", head, chain, (end) => (end.kind === "stop" || end.kind === "jump" ? runChains() : false));
    chains.pop();
    return r;
  };

  runChains();
  found.sort((a, b) => cmp(a.score, b.score));
  const result: Recovery = { candidates: found.slice(0, MAX_CANDIDATES) };
  if (!found.length) {
    result.reason = exhausted ? "the chart is too big or too tangled to rebuild" : (best?.reason ?? "the chart's structure can't be rebuilt");
  }
  return result;
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/**
 * Lower is better, compared in this order (tuned so the export of every chart in test/fixtures
 * and testpack/ comes back as written, test/tidy):
 *   1. steps inside select legs that jump away, when the select's one continuing leg is wired
 *      straight to the step after `end` (those steps could as well follow `end`);
 *   2. jumps;
 *   3. leg imbalance: sum over select blocks of (longest leg - shortest leg);
 *   4. nesting: sum of the branch depth of every step and transition;
 *   5. chains.
 */
function score(chains: Elem[][]): number[] {
  let nest = 0;
  let jumps = 0;
  let imbalance = 0;
  let jumpTail = 0;
  const legJumps = (leg: Elem[]): boolean => {
    const last = leg[leg.length - 1];
    return last?.k === "trans" && last.jump !== undefined;
  };
  const countSteps = (seq: Elem[]): number =>
    seq.reduce((n, el) => n + (el.k === "step" ? 1 : el.k === "trans" ? 0 : el.legs.reduce((m, l) => m + countSteps(l), 0)), 0);
  const visit = (seq: Elem[], depth: number): number => {
    let size = 0;
    for (const el of seq) {
      if (el.k === "step" || el.k === "trans") {
        size++;
        nest += depth;
        if (el.k === "trans" && el.jump !== undefined) jumps++;
        continue;
      }
      const sizes = el.legs.map((leg) => visit(leg, depth + 1));
      size += sizes.reduce((a, b) => a + b, 0);
      if (el.k !== "select") continue;
      imbalance += Math.max(...sizes) - Math.min(...sizes);
      if (el.direct) for (const leg of el.legs) if (legJumps(leg)) jumpTail += countSteps(leg);
    }
    return size;
  };
  for (const c of chains) visit(c, 0);
  return [jumpTail, jumps, imbalance, nest, chains.length];
}

function serialize(chains: Elem[][], initialId: string): string {
  const lines: string[] = [];
  const emit = (seq: Elem[], indent: string): void => {
    for (const el of seq) {
      if (el.k === "step") lines.push(`${indent}${el.id === initialId ? "init" : "step"} ${stepName(el.id)}`);
      else if (el.k === "trans") lines.push(`${indent}-- ${transName(el.id)}: TRUE${el.jump !== undefined ? ` -> ${stepName(el.jump)}` : ""}`);
      else {
        lines.push(`${indent}${el.k}`);
        el.legs.forEach((leg, i) => {
          if (i > 0) lines.push(`${indent}|`);
          emit(leg, `${indent}  `);
        });
        lines.push(`${indent}end`);
      }
    }
  };
  for (const c of chains) emit(c, "");
  return lines.join("\n") + "\n";
}
