/**
 * Render-time routing of jump wires for the SVG view. The Layout grid (and so the L5X
 * coordinates and the ASCII view) is not changed: this module only decides how the
 * SVG draws the wires of jumps (transitions with `-> target`) and of the automatic
 * convergences (SPEC §6.4).
 *
 * Rules:
 *   - side: a return line goes up on the side of its leg. A jump in the main column of
 *     a chain, or in the leftmost leg of a branch, loops on the left; a jump in any
 *     other leg loops on the right (`planRoutes`, `Jump.side`);
 *   - lanes hug the chart and nest: the SVG renderer places each lane just past the
 *     widest element over the rows it covers, shortest loops innermost;
 *   - entry: a jump into a step that has another input joins the line above that step
 *     with an arrowhead (T-junction). Automatic convergence bars are not drawn (the L5X
 *     keeps them). A jump into a step with no other input enters it from the top;
 *     several such jumps share one stub above the step;
 *   - horizontals in one gap between two rows are stacked (`orderLanes`) so that a
 *     horizontal never runs over the free end of a vertical of another wire;
 *   - when a crossing is left anyway, the renderer replaces the wire by a GRAFCET
 *     cross-reference (short arrow labelled with the target, "from T…" at the target).
 *     `segmentsCross` / `segmentHitsBox` are the geometry checks it uses.
 */
import type { TransitionNode } from "../model/ast.js";
import type { GBranch, Graph, GraphId } from "../model/graph.js";
import type { Layout } from "../layout/index.js";

export type Side = "left" | "right";

export interface Jump {
  /** `data-id` of the wire: the graph link `from-to` (to = the step, or the convergence leg). */
  id: string;
  /** Source transition. */
  from: GraphId;
  /** Target step. */
  target: GraphId;
  side: Side;
  /** Left: the source column (lane left of it). Right: the last column of the source's branch. */
  anchor: number;
  /** Column group (chain) of the source. */
  group: number;
  targetGroup: number;
  srcRow: number;
  srcCol: number;
  tgtRow: number;
  tgtCol: number;
  /** Gap g is between rows g - 1 and g. The wire leaves its source in the gap below it... */
  exitGap: number;
  /** ...and reaches its target in the gap above it. */
  entryGap: number;
  /** The target has no other drawn input: the wire enters it from the top. */
  top: boolean;
  /** File order of the source transition. */
  order: number;
}

export interface PlainLink {
  id: string;
  from: GraphId;
  to: GraphId;
}

export interface RoutePlan {
  jumps: Jump[];
  /** Graph links drawn as straight lines (jog links and jump links excluded). */
  links: PlainLink[];
  /** Automatic convergence bars: not drawn. */
  hiddenBars: Set<GraphId>;
}

export function planRoutes(graph: Graph, layout: Layout): RoutePlan {
  const transById = new Map(graph.transitions.map((t) => [t.id, t]));
  const stepIds = new Set(graph.steps.map((s) => s.id));
  const branchById = new Map(graph.branches.map((b) => [b.id, b]));
  const isJumpSource = (id: GraphId): boolean => transById.get(id)?.node.jump !== undefined;
  const hiddenBars = new Set(graph.branches.filter((b) => !b.node).map((b) => b.id));
  const loopBars = new Set([...hiddenBars].filter((id) => layout.bars.get(id)?.placement === "loop"));
  const barOfLeg = (id: GraphId): GraphId | undefined => layout.legs.get(id)?.branch;
  const jogs = layout.wires.filter((w) => w.kind === "jog");
  const jogKeys = new Set(jogs.map((w) => `${w.from}>${w.to}`));
  const groupOf = (col: number): number => layout.columns[col]?.group ?? 0;

  // Innermost branch (and leg) around each transition.
  const enclosing = new Map<TransitionNode, { branch: GBranch; leg: number }>();
  for (const b of graph.branches) {
    if (!b.node || b.flow !== "diverge") continue;
    b.node.legs.forEach((seq, k) => {
      for (const el of seq) if (el.kind === "transition") enclosing.set(el, { branch: b, leg: k });
    });
  }

  const links: PlainLink[] = [];
  const jumpLinks: Array<{ from: GraphId; to: GraphId }> = [];
  for (const l of graph.links) {
    if (isJumpSource(l.from)) jumpLinks.push(l);
    else if (loopBars.has(l.from) || loopBars.has(barOfLeg(l.to) ?? "")) continue;
    else if (jogKeys.has(`${l.from}>${l.to}`)) continue;
    else links.push({ id: `${l.from}-${l.to}`, from: l.from, to: l.to });
  }

  const targetOf = (to: GraphId): GraphId | undefined => {
    if (stepIds.has(to)) return to;
    const bid = barOfLeg(to);
    const b = bid === undefined ? undefined : branchById.get(bid);
    if (!b) return undefined;
    if (b.target !== undefined) return b.target;
    return graph.links.find((x) => x.from === b.id)?.to;
  };
  const hasInput = (step: GraphId): boolean => links.some((l) => l.to === step) || jogs.some((w) => w.to === step);

  const jumps: Jump[] = [];
  for (const l of jumpLinks) {
    const t = transById.get(l.from)!;
    const target = targetOf(l.to);
    const src = layout.nodes.get(l.from);
    const tgt = target === undefined ? undefined : layout.nodes.get(target);
    if (!src || !tgt || target === undefined) continue;
    const enc = enclosing.get(t.node);
    let side: Side = "left";
    let anchor = src.col;
    if (enc && enc.leg > 0) {
      side = "right";
      anchor = Math.max(...enc.branch.legs.map((g) => layout.legs.get(g.id)?.colEnd ?? src.col), src.col);
    }
    jumps.push({
      id: `${l.from}-${l.to}`,
      from: l.from,
      target,
      side,
      anchor,
      group: groupOf(src.col),
      targetGroup: groupOf(tgt.col),
      srcRow: src.row,
      srcCol: src.col,
      tgtRow: tgt.row,
      tgtCol: tgt.col,
      exitGap: src.row + 1,
      entryGap: tgt.row,
      top: !hasInput(target),
      order: t.index,
    });
  }
  return { jumps, links, hiddenBars };
}

/** Gap interval [lo, hi] covered by a jump's lane. */
export function gapSpan(j: Jump): [number, number] {
  return [Math.min(j.entryGap, j.exitGap), Math.max(j.entryGap, j.exitGap)];
}

export function spansOverlap(a: Jump, b: Jump): boolean {
  const [a0, a1] = gapSpan(a);
  const [b0, b1] = gapSpan(b);
  return a0 <= b1 && b0 <= a1;
}

// ---------------------------------------------------------------------------------------------
// Horizontals in one gap
// ---------------------------------------------------------------------------------------------

export interface HEnd {
  x: number;
  /** Direction of the vertical attached at this end ("none": no vertical of its own). */
  dir: "up" | "down" | "none";
}

export interface HLine {
  x0: number;
  x1: number;
  ends: HEnd[];
  /** Output: lane index in the gap (0 = highest). */
  lane: number;
}

const OVERLAP_PAD = 6;

/**
 * Stacks the horizontals of one gap: overlapping ones get different lanes, and when a
 * vertical going down (up) from one end of a line lies inside another line's range,
 * the other line goes above (below) it, so they do not cross. Returns the lane count.
 */
export function orderLanes(hs: HLine[]): number {
  const n = hs.length;
  if (n === 0) return 0;
  const overlap = (a: HLine, b: HLine): boolean => !(a.x1 + OVERLAP_PAD < b.x0 || b.x1 + OVERLAP_PAD < a.x0);
  const inside = (x: number, h: HLine): boolean => x > h.x0 + 0.5 && x < h.x1 - 0.5;
  const preds: Array<Set<number>> = hs.map(() => new Set());
  const addAbove = (a: number, b: number): void => {
    if (a !== b) preds[b]!.add(a);
  };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b || !overlap(hs[a]!, hs[b]!)) continue;
      for (const e of hs[b]!.ends) {
        if (!inside(e.x, hs[a]!)) continue;
        if (e.dir === "down") addAbove(a, b);
        else if (e.dir === "up") addAbove(b, a);
      }
    }
  }
  // Kahn's order, lowest index first; a cycle is broken at its lowest index.
  const done = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if ([...preds[i]!].every((p) => done[p])) {
        pick = i;
        break;
      }
    }
    if (pick < 0) pick = done.findIndex((d) => !d);
    done[pick] = true;
    order.push(pick);
  }
  const placed: number[] = [];
  let lanes = 0;
  for (const i of order) {
    const h = hs[i]!;
    let lane = 0;
    for (const p of preds[i]!) if (placed.includes(p) && overlap(hs[p]!, h)) lane = Math.max(lane, hs[p]!.lane + 1);
    while (placed.some((p) => hs[p]!.lane === lane && overlap(hs[p]!, h))) lane++;
    h.lane = lane;
    placed.push(i);
    lanes = Math.max(lanes, lane + 1);
  }
  return lanes;
}

// ---------------------------------------------------------------------------------------------
// Geometry checks (axis-aligned segments and boxes)
// ---------------------------------------------------------------------------------------------

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  owner: string;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  owner: string;
}

const EPS = 0.01;

/**
 * True when two axis-aligned segments cross or overlap along a common line. Touching
 * at an end (a corner, or a T-junction where one segment ends on the other) is fine.
 */
export function segmentsCross(a: Seg, b: Seg): boolean {
  const ah = Math.abs(a.y0 - a.y1) < EPS;
  const bh = Math.abs(b.y0 - b.y1) < EPS;
  const av = Math.abs(a.x0 - a.x1) < EPS;
  const bv = Math.abs(b.x0 - b.x1) < EPS;
  if ((ah && av) || (bh && bv)) return false;
  const ax0 = Math.min(a.x0, a.x1);
  const ax1 = Math.max(a.x0, a.x1);
  const ay0 = Math.min(a.y0, a.y1);
  const ay1 = Math.max(a.y0, a.y1);
  const bx0 = Math.min(b.x0, b.x1);
  const bx1 = Math.max(b.x0, b.x1);
  const by0 = Math.min(b.y0, b.y1);
  const by1 = Math.max(b.y0, b.y1);
  if (ah && bh) return Math.abs(a.y0 - b.y0) < EPS && Math.min(ax1, bx1) - Math.max(ax0, bx0) > EPS;
  if (av && bv) return Math.abs(a.x0 - b.x0) < EPS && Math.min(ay1, by1) - Math.max(ay0, by0) > EPS;
  const h = ah ? { x0: ax0, x1: ax1, y: a.y0 } : { x0: bx0, x1: bx1, y: b.y0 };
  const v = ah ? { y0: by0, y1: by1, x: b.x0 } : { y0: ay0, y1: ay1, x: a.x0 };
  return h.y > v.y0 + EPS && h.y < v.y1 - EPS && v.x > h.x0 + EPS && v.x < h.x1 - EPS;
}

/**
 * True when an axis-aligned segment runs through the inside of a box. A segment with an
 * end inside the box is connected to it (a link into a transition bar) and does not count.
 */
export function segmentHitsBox(s: Seg, b: Box): boolean {
  const inBox = (x: number, y: number): boolean => x > b.x0 + EPS && x < b.x1 - EPS && y > b.y0 + EPS && y < b.y1 - EPS;
  if (inBox(s.x0, s.y0) || inBox(s.x1, s.y1)) return false;
  const k = 0.5;
  const x0 = Math.min(s.x0, s.x1);
  const x1 = Math.max(s.x0, s.x1);
  const y0 = Math.min(s.y0, s.y1);
  const y1 = Math.max(s.y0, s.y1);
  return x1 > b.x0 + k && x0 < b.x1 - k && y1 > b.y0 + k && y0 < b.y1 - k;
}
