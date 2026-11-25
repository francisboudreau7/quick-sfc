/**
 * Lowering: a valid Chart -> Graph shaped like Studio 5000's SFCContent
 * (src/model/graph.ts documents the link patterns). SPEC §5, §6.4, §8.2.
 *
 * Precondition: parse() and validate() reported no errors (see the invariants listed
 * in src/validate/index.ts). Output is deterministic.
 *
 * Incoming paths of a step S:
 *   - the continuing legs of the select right before S (last transition of each leg),
 *   - the transition right before S (normal flow),
 *   - the parallel diverge leg, when S is the first step of a parallel leg,
 *   - every transition that jumps to S (file order).
 * One incoming path: a direct link. Two or more: a selection convergence in front of S
 * (the explicit select's converge, or an automatic one with `target`).
 */
import type { BranchNode, Chart, Element, Sequence, StepNode, TransitionNode } from "../model/ast.js";
import { allSteps, allTransitions, key, walk } from "../model/ast.js";
import type { GBranch, GLink, Graph, GraphId, GStep, GTransition } from "../model/graph.js";
import { collectInfo, continuingLegs, stepsByKey } from "../validate/flow.js";

type Source =
  | { kind: "transition"; node: TransitionNode }
  | { kind: "divergeLeg"; branch: BranchNode; leg: number };

interface Incoming {
  /** Select whose convergence step this is (with at least one continuing leg). */
  select?: BranchNode;
  sources: Source[];
}

interface BranchPlan {
  line: number;
  /** Tie-breaker: diverge before converge of the same block. */
  order: number;
  type: GBranch["type"];
  flow: GBranch["flow"];
  node?: BranchNode;
  target?: StepNode;
  legCount: number;
  /** Resolved after ids are known. */
  sources?: () => GraphId[];
  id?: GraphId;
}

export function lower(chart: Chart): Graph {
  const stepNodes = allSteps(chart);
  const transNodes = allTransitions(chart);
  const stepId = new Map<StepNode, GraphId>();
  const transId = new Map<TransitionNode, GraphId>();
  const transIndex = new Map<TransitionNode, number>();

  const steps: GStep[] = stepNodes.map((s, index) => {
    const id = `s${index}`;
    stepId.set(s, id);
    const g: GStep = {
      id,
      index,
      name: s.name.text,
      initial: s.initial,
      presetMs: s.presetMs ?? 0,
      action: s.action.map((a) => a.text),
      node: s,
    };
    if (s.description !== undefined) g.description = s.description;
    return g;
  });
  const transitions: GTransition[] = transNodes.map((t, index) => {
    const id = `t${index}`;
    transId.set(t, id);
    transIndex.set(t, index);
    return { id, index, name: t.name.text, auto: t.auto, condition: t.condition.text, node: t };
  });

  const info = collectInfo(chart);
  const byKey = stepsByKey(chart);

  // ---- incoming paths per step ---------------------------------------------------
  const jumpsTo = new Map<StepNode, TransitionNode[]>();
  for (const t of transNodes) {
    if (!t.jump) continue;
    const s = byKey.get(key(t.jump.text));
    if (!s) continue;
    const list = jumpsTo.get(s) ?? [];
    list.push(t);
    jumpsTo.set(s, list);
  }

  const incoming = new Map<StepNode, Incoming>();
  for (const s of stepNodes) {
    const i = info.get(s)!;
    const prev = i.seq[i.index - 1];
    const inc: Incoming = { sources: [] };
    const transSources: TransitionNode[] = [];
    if (prev?.kind === "select") {
      const legs = continuingLegs(prev);
      if (legs.length > 0) {
        inc.select = prev;
        for (const leg of legs) inc.sources.push({ kind: "transition", node: leg[leg.length - 1] as TransitionNode });
      }
    } else if (prev?.kind === "transition" && !prev.jump) {
      transSources.push(prev);
    } else if (prev === undefined && i.parent?.kind === "parallel") {
      inc.sources.push({ kind: "divergeLeg", branch: i.parent, leg: i.leg });
    }
    transSources.push(...(jumpsTo.get(s) ?? []));
    if (!inc.select) transSources.sort((a, b) => transIndex.get(a)! - transIndex.get(b)!);
    for (const t of transSources) inc.sources.push({ kind: "transition", node: t });
    incoming.set(s, inc);
  }

  // ---- branches -------------------------------------------------------------------
  const plans: BranchPlan[] = [];
  const divergeOf = new Map<BranchNode, BranchPlan>();
  const convergeOf = new Map<BranchNode, BranchPlan>();
  const autoOf = new Map<StepNode, BranchPlan>();
  const sourceId = (src: Source): GraphId =>
    src.kind === "transition" ? transId.get(src.node)! : `${divergeOf.get(src.branch)!.id!}.${src.leg}`;

  for (const el of walk(chart.body)) {
    if (el.kind === "select" || el.kind === "parallel") {
      const d: BranchPlan = {
        line: el.span.line,
        order: 0,
        type: el.kind === "select" ? "selection" : "simultaneous",
        flow: "diverge",
        node: el,
        legCount: el.legs.length,
      };
      plans.push(d);
      divergeOf.set(el, d);
      if (el.kind === "parallel") {
        const lastSteps = el.legs.map((l) => l[l.length - 1] as StepNode);
        const c: BranchPlan = {
          line: (el.endSpan ?? el.span).line,
          order: 1,
          type: "simultaneous",
          flow: "converge",
          node: el,
          legCount: el.legs.length,
          sources: () => lastSteps.map((s) => stepId.get(s)!),
        };
        plans.push(c);
        convergeOf.set(el, c);
      }
    } else if (el.kind === "step") {
      const inc = incoming.get(el)!;
      if (inc.sources.length < 2) continue;
      const srcs = inc.sources;
      if (inc.select) {
        const c: BranchPlan = {
          line: (inc.select.endSpan ?? inc.select.span).line,
          order: 1,
          type: "selection",
          flow: "converge",
          node: inc.select,
          legCount: srcs.length,
          sources: () => srcs.map(sourceId),
        };
        plans.push(c);
        convergeOf.set(inc.select, c);
      } else {
        const c: BranchPlan = {
          line: el.span.line,
          order: 1,
          type: "selection",
          flow: "converge",
          target: el,
          legCount: srcs.length,
          sources: () => srcs.map(sourceId),
        };
        plans.push(c);
        autoOf.set(el, c);
      }
    }
  }
  plans.sort((a, b) => a.line - b.line || a.order - b.order);
  plans.forEach((p, i) => (p.id = `b${i}`));
  const legId = (p: BranchPlan, k: number): GraphId => `${p.id!}.${k}`;

  const branches: GBranch[] = plans.map((p) => {
    const g: GBranch = {
      id: p.id!,
      type: p.type,
      flow: p.flow,
      legs: Array.from({ length: p.legCount }, (_, k) => ({ id: legId(p, k) })),
    };
    if (p.node) g.node = p.node;
    if (p.target) g.target = stepId.get(p.target)!;
    if (p.sources) g.sources = p.sources();
    return g;
  });

  // ---- links, in file order ---------------------------------------------------------
  const links: GLink[] = [];
  const link = (from: GraphId, to: GraphId): void => {
    links.push({ from, to });
  };
  const idOf = (el: Element): GraphId =>
    el.kind === "step" ? stepId.get(el)! : el.kind === "transition" ? transId.get(el)! : divergeOf.get(el)!.id!;

  const intoStep = (s: StepNode): void => {
    const inc = incoming.get(s)!;
    const sid = stepId.get(s)!;
    if (inc.sources.length === 1) {
      link(sourceId(inc.sources[0]!), sid);
      return;
    }
    if (inc.sources.length === 0) return;
    const conv = inc.select ? convergeOf.get(inc.select)! : autoOf.get(s)!;
    inc.sources.forEach((src, k) => link(sourceId(src), legId(conv, k)));
    link(conv.id!, sid);
  };

  const emit = (seq: Sequence): void => {
    seq.forEach((el, i) => {
      const next = seq[i + 1];
      if (el.kind === "step") {
        intoStep(el);
        if (next && (next.kind === "transition" || next.kind === "select")) link(idOf(el), idOf(next));
      } else if (el.kind === "transition") {
        if (next?.kind === "parallel") link(idOf(el), idOf(next));
      } else if (el.kind === "select") {
        const d = divergeOf.get(el)!;
        el.legs.forEach((leg, k) => {
          const first = leg[0];
          if (first) link(legId(d, k), idOf(first));
          emit(leg);
        });
      } else {
        el.legs.forEach((leg) => emit(leg));
        const c = convergeOf.get(el)!;
        el.legs.forEach((leg, k) => {
          const last = leg[leg.length - 1];
          if (last) link(idOf(last), legId(c, k));
        });
        if (next) link(c.id!, idOf(next));
      }
    });
  };
  emit(chart.body);

  return { steps, transitions, branches, links };
}
