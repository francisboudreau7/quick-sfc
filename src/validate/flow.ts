/**
 * Structural facts about a Chart shared by the validator and the lowering:
 * where each element sits, and the flow + jump graph (SPEC §6).
 */
import type { BranchNode, Chart, Element, Sequence, StepNode, TransitionNode } from "../model/ast.js";
import { key, walk } from "../model/ast.js";

export interface ElementInfo {
  /** Sequence that contains the element, and its index there. */
  seq: Sequence;
  index: number;
  /** Enclosing branch and leg index (null at top level). */
  parent: BranchNode | null;
  leg: number;
  /** Innermost parallel leg, as "parallel object id.leg", or null outside any parallel. */
  parLeg: string | null;
  /** True when the element is inside any branch. */
  inBranch: boolean;
}

export function isJump(el: Element | undefined): el is TransitionNode {
  return el !== undefined && el.kind === "transition" && el.jump !== undefined;
}

/** Last element of a leg is a jumping transition. */
export function legJumps(leg: Sequence): boolean {
  return isJump(leg[leg.length - 1]);
}

/** A select whose legs all end with a jump: nothing merges after it. */
export function allLegsJump(b: BranchNode): boolean {
  return b.kind === "select" && b.legs.length > 0 && b.legs.every(legJumps);
}

/** Legs of a select whose flow continues after `end` (non-empty, last element not a jump). */
export function continuingLegs(b: BranchNode): Sequence[] {
  return b.legs.filter((l) => l.length > 0 && !legJumps(l));
}

export function collectInfo(chart: Chart): Map<Element, ElementInfo> {
  const info = new Map<Element, ElementInfo>();
  let parCount = 0;
  const visit = (seq: Sequence, parent: BranchNode | null, leg: number, parLeg: string | null): void => {
    seq.forEach((el, index) => {
      info.set(el, { seq, index, parent, leg, parLeg, inBranch: parent !== null });
      if (el.kind === "select" || el.kind === "parallel") {
        const pid = el.kind === "parallel" ? `p${parCount++}` : null;
        el.legs.forEach((l, k) => visit(l, el, k, pid ? `${pid}.${k}` : parLeg));
      }
    });
  };
  visit(chart.body, null, 0, null);
  return info;
}

/** First step for each name key (duplicates are E309). */
export function stepsByKey(chart: Chart): Map<string, StepNode> {
  const m = new Map<string, StepNode>();
  for (const el of walk(chart.body)) {
    if (el.kind === "step" && el.name.text && !m.has(key(el.name.text))) m.set(key(el.name.text), el);
  }
  return m;
}

export interface FlowGraph {
  succ: Map<Element, Element[]>;
  pred: Map<Element, Element[]>;
}

/**
 * Directed graph over elements: step -> next, transition -> next or jump target,
 * branch -> first element of each leg, last element of each leg -> element after `end`.
 * The flow stops after a jump and after a select whose legs all jump.
 */
export function buildFlow(chart: Chart): FlowGraph {
  const succ = new Map<Element, Element[]>();
  const pred = new Map<Element, Element[]>();
  const steps = stepsByKey(chart);
  const edge = (a: Element, b: Element): void => {
    const s = succ.get(a) ?? [];
    if (!s.includes(b)) s.push(b);
    succ.set(a, s);
    const p = pred.get(b) ?? [];
    if (!p.includes(a)) p.push(a);
    pred.set(b, p);
  };
  const seqFlow = (seq: Sequence): Element[] => {
    let prev: Element[] | null = null;
    for (const el of seq) {
      if (prev) for (const x of prev) edge(x, el);
      const exits = elFlow(el);
      prev = exits.length > 0 ? exits : null;
    }
    return prev ?? [];
  };
  const elFlow = (el: Element): Element[] => {
    if (el.kind === "step") return [el];
    if (el.kind === "transition") {
      if (el.jump) {
        const target = steps.get(key(el.jump.text));
        if (target) edge(el, target);
        return [];
      }
      return [el];
    }
    const exits: Element[] = [];
    for (const leg of el.legs) {
      const first = leg[0];
      if (first) edge(el, first);
      exits.push(...seqFlow(leg));
    }
    return exits;
  };
  seqFlow(chart.body);
  return { succ, pred };
}
