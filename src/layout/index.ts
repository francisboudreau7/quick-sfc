/**
 * Layout engine: one grid layout for every view (ASCII, L5X coordinates, later SVG).
 *
 * The grid is structure-driven (it walks the Chart tree, not the graph):
 *   - a sequence goes down one column, one row per step / transition;
 *   - a branch takes one row for its divergence bar, then places its legs side by
 *     side (each leg as wide as its widest nested content), then one row for its
 *     convergence bar; the element after the convergence comes back to the branch's
 *     first column, so the main line stays straight on the left and legs extend to
 *     the right (Studio 5000 style, as in the reference export);
 *   - each chain (SPEC §6.3) after the first one is a new column group to the right
 *     of everything already placed, top-aligned at row 0;
 *   - automatic convergences (GBranch.target): when the target has an in-flow source
 *     (the transition above it, or a parallel leg start) the bar gets its own row
 *     right above the target; otherwise the target is a chain head (only reached by
 *     jumps, so above all its sources) and the bar goes just below the lowest source,
 *     with a "loop" wire back up to the target;
 *   - wires that are not straight vertical links (jumps, jumps into a convergence,
 *     loop-backs) run in channel columns at the right of their column group;
 *     a select whose only continuing leg is not its first leg gets a "jog" wire.
 *
 * Rows and columns are integers. Wire points may sit on half rows (between rows).
 * L5X coordinates are derived from the grid by `l5xPositions`.
 */
import type { BranchNode, Chart, Sequence, StepNode, TransitionNode } from "../model/ast.js";
import type { GBranch, Graph, GraphId, GStep, GTransition } from "../model/graph.js";
import type { L5XPositions } from "../model/positions.js";
import { continuingLegs, isJump } from "../validate/flow.js";

export interface GridPoint {
  /** Row; may be a half row (r ± 0.5) between two rows. */
  row: number;
  col: number;
}

export interface NodePlace {
  id: GraphId;
  kind: "step" | "transition";
  row: number;
  col: number;
}

export interface BarPlace {
  /** Branch id. */
  id: GraphId;
  row: number;
  /** First column: the stem (where the line in / out of the bar is attached). */
  col: number;
  /** Last column the bar spans (inclusive). */
  colEnd: number;
  /**
   * "structural": divergence / convergence of a select or parallel block.
   * "above": automatic convergence in its own row right above its target.
   * "loop": automatic convergence below its (jump) sources, wired back up to its target.
   */
  placement: "structural" | "above" | "loop";
}

export interface LegPlace {
  id: GraphId;
  branch: GraphId;
  /** Column where the leg meets the bar. */
  col: number;
  /** Column range of the leg content (inclusive); equals `col` for wired legs. */
  colEnd: number;
  /** true when the leg is fed by a wire (a jump into a convergence), not by a vertical line. */
  wired: boolean;
}

export type WireKind =
  /** Transition -> step jump (no convergence in front of the step). */
  | "jump"
  /** Jumping transition -> leg of a convergence bar. */
  | "jump-leg"
  /** Automatic convergence bar (placed low) -> its target step. */
  | "loop"
  /** Last transition of the only continuing select leg -> next step in the branch column. */
  | "jog";

export interface Wire {
  kind: WireKind;
  from: GraphId;
  /** Step id, or leg id for "jump-leg". */
  to: GraphId;
  /** Orthogonal polyline, from the source element to the target element. */
  points: GridPoint[];
}

export interface LayoutColumn {
  kind: "element" | "channel";
  /** Index of the column group (chain). */
  group: number;
}

export interface ColumnGroup {
  /** First step of the chain. */
  head: GraphId;
  col: number;
  /** Last element column of the group (channels excluded). */
  colEnd: number;
}

export interface Layout {
  rows: number;
  columns: LayoutColumn[];
  groups: ColumnGroup[];
  /** Steps and transitions. */
  nodes: Map<GraphId, NodePlace>;
  /** Every branch of the graph. */
  bars: Map<GraphId, BarPlace>;
  /** Every leg of every branch. */
  legs: Map<GraphId, LegPlace>;
  wires: Wire[];
}

// ---- L5X spacing (Studio 5000 units), see L5X_GUIDE §6.3 and the Test_Parallel import ----
export const L5X_ORIGIN_X = 200;
export const L5X_ORIGIN_Y = 100;
/** Horizontal distance between two element columns (legs ~200-300 apart). */
export const L5X_COL_WIDTH = 300;
export const L5X_CHANNEL_WIDTH = 60;
/** Step or transition to step or transition. */
export const L5X_NODE_PITCH = 120;
/** Step to branch bar. */
export const L5X_STEP_BAR_PITCH = 100;
/** Transition to bar, or bar to anything (verified: Test_Parallel import). */
export const L5X_BAR_PITCH = 60;

interface Ctx {
  stepOf: Map<StepNode, GStep>;
  transOf: Map<TransitionNode, GTransition>;
  transById: Map<GraphId, GTransition>;
  divergeOf: Map<BranchNode, GBranch>;
  convergeOf: Map<BranchNode, GBranch>;
  /** Automatic convergences placed right above their target, by target step id. */
  autoAbove: Map<GraphId, GBranch>;
  nodes: Map<GraphId, NodePlace>;
  bars: Map<GraphId, BarPlace>;
  legs: Map<GraphId, LegPlace>;
  jogs: Array<{ from: GraphId; row: number; stemCol: number; legCol: number; srcRow: number }>;
}

const isLegId = (id: GraphId): boolean => id.includes(".");

export function layout(graph: Graph, chart: Chart): Layout {
  const ctx: Ctx = {
    stepOf: new Map(graph.steps.map((s) => [s.node, s])),
    transOf: new Map(graph.transitions.map((t) => [t.node, t])),
    transById: new Map(graph.transitions.map((t) => [t.id, t])),
    divergeOf: new Map(),
    convergeOf: new Map(),
    autoAbove: new Map(),
    nodes: new Map(),
    bars: new Map(),
    legs: new Map(),
    jogs: [],
  };
  const isJumpSource = (id: GraphId): boolean => ctx.transById.get(id)?.node.jump !== undefined;
  const autoLoop: GBranch[] = [];
  for (const b of graph.branches) {
    if (b.node) (b.flow === "diverge" ? ctx.divergeOf : ctx.convergeOf).set(b.node, b);
    else if (b.target !== undefined) {
      if ((b.sources ?? []).some((s) => !isJumpSource(s))) ctx.autoAbove.set(b.target, b);
      else autoLoop.push(b);
    }
  }

  // ---- chains -> column groups (channels are inserted later) ----
  const chains = splitChains(chart.body);
  const groups: ColumnGroup[] = [];
  let nextCol = 0;
  let rows = 0;
  for (const chain of chains) {
    const res = placeSeq(ctx, chain, nextCol, 0);
    const head = chain[0];
    groups.push({
      head: head && head.kind === "step" ? ctx.stepOf.get(head)!.id : "",
      col: nextCol,
      colEnd: nextCol + res.width - 1,
    });
    nextCol += res.width;
    rows = Math.max(rows, res.row);
  }

  // ---- occupancy (nodes, bars, jogs) ----
  const occupied = new Set<string>();
  const cell = (r: number, c: number): string => `${r},${c}`;
  const occupyRow = (r: number, c0: number, c1: number): void => {
    for (let c = c0; c <= c1; c++) occupied.add(cell(r, c));
  };
  for (const n of ctx.nodes.values()) occupied.add(cell(n.row, n.col));
  for (const b of ctx.bars.values()) occupyRow(b.row, b.col, b.colEnd);
  for (const j of ctx.jogs) occupyRow(j.row, Math.min(j.stemCol, j.legCol), Math.max(j.stemCol, j.legCol));
  for (const n of ctx.nodes.values()) rows = Math.max(rows, n.row + 1);

  // ---- automatic convergences below their sources (loop back to a chain head) ----
  for (const b of autoLoop) {
    const srcs = (b.sources ?? []).map((id) => ctx.nodes.get(id)!);
    const lowest = Math.max(...srcs.map((s) => s.row));
    const verticalFree = (s: NodePlace, r: number): boolean => {
      for (let k = s.row + 1; k < r; k++) if (occupied.has(cell(k, s.col))) return false;
      return true;
    };
    const spanFree = (r: number, c0: number, c1: number): boolean => {
      for (let c = c0; c <= c1; c++) if (occupied.has(cell(r, c))) return false;
      return true;
    };
    let row = -1;
    let vertical = srcs;
    for (let r = lowest + 1; r < rows; r++) {
      const c0 = Math.min(...srcs.map((s) => s.col));
      const c1 = Math.max(...srcs.map((s) => s.col));
      if (spanFree(r, c0, c1) && srcs.every((s) => verticalFree(s, r))) {
        row = r;
        break;
      }
    }
    if (row < 0) {
      // Below everything: the span is free; sources whose way down is blocked get a wire.
      row = rows;
      vertical = srcs.filter((s) => verticalFree(s, row));
    }
    const target = ctx.nodes.get(b.target!)!;
    const cols = (vertical.length > 0 ? vertical : [target]).map((s) => s.col);
    const bar: BarPlace = { id: b.id, row, col: Math.min(...cols), colEnd: Math.max(...cols), placement: "loop" };
    ctx.bars.set(b.id, bar);
    occupyRow(row, bar.col, bar.colEnd);
    rows = Math.max(rows, row + 1);
    b.legs.forEach((leg, k) => {
      const s = srcs[k]!;
      const wired = !vertical.includes(s);
      ctx.legs.set(leg.id, { id: leg.id, branch: b.id, col: wired ? bar.colEnd : s.col, colEnd: wired ? bar.colEnd : s.col, wired });
    });
  }

  // ---- wires that need a channel, each owned by one column group ----
  const groupOf = (col: number): number => {
    const g = groups.findIndex((gr) => col >= gr.col && col <= gr.colEnd);
    return g < 0 ? groups.length - 1 : g;
  };
  interface Pending {
    kind: WireKind;
    from: GraphId;
    to: GraphId;
    group: number;
  }
  const pending: Pending[] = [];
  for (const l of graph.links) {
    if (!isJumpSource(l.from)) continue;
    const src = ctx.nodes.get(l.from)!;
    if (ctx.nodes.has(l.to)) pending.push({ kind: "jump", from: l.from, to: l.to, group: groupOf(src.col) });
    else if (ctx.legs.get(l.to)?.wired) pending.push({ kind: "jump-leg", from: l.from, to: l.to, group: groupOf(src.col) });
  }
  for (const b of autoLoop) {
    const target = ctx.nodes.get(b.target!)!;
    pending.push({ kind: "loop", from: b.id, to: b.target!, group: groupOf(target.col) });
  }
  const channelsPerGroup = groups.map((_, g) => pending.filter((p) => p.group === g).length);

  // ---- insert channel columns: shift every column by the channels of earlier groups ----
  const shiftOfGroup: number[] = [];
  let acc = 0;
  for (let g = 0; g < groups.length; g++) {
    shiftOfGroup.push(acc);
    acc += channelsPerGroup[g]!;
  }
  const groupOfCol = Array.from({ length: nextCol }, (_, c) => groupOf(c));
  const shift = (col: number): number => col + (shiftOfGroup[groupOfCol[col]!] ?? 0);
  for (const n of ctx.nodes.values()) n.col = shift(n.col);
  for (const b of ctx.bars.values()) {
    b.col = shift(b.col);
    b.colEnd = shift(b.colEnd);
  }
  for (const l of ctx.legs.values()) {
    l.col = shift(l.col);
    l.colEnd = shift(l.colEnd);
  }
  for (const j of ctx.jogs) {
    j.stemCol = shift(j.stemCol);
    j.legCol = shift(j.legCol);
  }
  const columns: LayoutColumn[] = [];
  groups.forEach((gr, g) => {
    const width = gr.colEnd - gr.col + 1;
    gr.col = shift(gr.col);
    gr.colEnd = gr.col + width - 1;
    for (let k = 0; k < width; k++) columns.push({ kind: "element", group: g });
    for (let k = 0; k < channelsPerGroup[g]!; k++) columns.push({ kind: "channel", group: g });
  });

  // ---- routes ----
  const wires: Wire[] = [];
  const used = groups.map(() => 0);
  for (const p of pending) {
    const ch = groups[p.group]!.colEnd + 1 + used[p.group]!++;
    if (p.kind === "loop") {
      const bar = ctx.bars.get(p.from)!;
      const t = ctx.nodes.get(p.to)!;
      wires.push({
        kind: p.kind,
        from: p.from,
        to: p.to,
        points: [
          { row: bar.row, col: bar.col },
          { row: bar.row + 0.5, col: bar.col },
          { row: bar.row + 0.5, col: ch },
          { row: t.row - 0.5, col: ch },
          { row: t.row - 0.5, col: t.col },
          { row: t.row, col: t.col },
        ],
      });
      continue;
    }
    const s = ctx.nodes.get(p.from)!;
    let end: GridPoint;
    if (p.kind === "jump") {
      const t = ctx.nodes.get(p.to)!;
      end = { row: t.row, col: t.col };
    } else {
      const leg = ctx.legs.get(p.to)!;
      end = { row: ctx.bars.get(leg.branch)!.row, col: leg.col };
    }
    wires.push({
      kind: p.kind,
      from: p.from,
      to: p.to,
      points: [
        { row: s.row, col: s.col },
        { row: s.row + 0.5, col: s.col },
        { row: s.row + 0.5, col: ch },
        { row: end.row - 0.5, col: ch },
        { row: end.row - 0.5, col: end.col },
        end,
      ],
    });
  }
  for (const j of ctx.jogs) {
    const link = graph.links.find((l) => l.from === j.from);
    const t = link ? ctx.nodes.get(link.to) : undefined;
    if (!link || !t) continue;
    wires.push({
      kind: "jog",
      from: j.from,
      to: link.to,
      points: [
        { row: j.srcRow, col: j.legCol },
        { row: j.row, col: j.legCol },
        { row: j.row, col: j.stemCol },
        { row: t.row, col: t.col },
      ],
    });
  }

  return { rows, columns, groups, nodes: ctx.nodes, bars: ctx.bars, legs: ctx.legs, wires };
}

/** Top-level chains (SPEC §6.3): a new chain starts at a step that follows a flow stop. */
function splitChains(body: Sequence): Sequence[] {
  const chains: Sequence[] = [];
  let current: Sequence = [];
  let stopped = false;
  for (const el of body) {
    if (stopped && el.kind === "step" && current.length > 0) {
      chains.push(current);
      current = [];
    }
    current.push(el);
    stopped = isJump(el) || (el.kind === "select" && continuingLegs(el).length === 0);
  }
  if (current.length > 0) chains.push(current);
  return chains;
}

/** Places a sequence going down column `col` from `row`. Returns its width and the next free row. */
function placeSeq(ctx: Ctx, seq: Sequence, col: number, row: number): { width: number; row: number } {
  let width = 1;
  for (const el of seq) {
    if (el.kind === "step") {
      const s = ctx.stepOf.get(el)!;
      const auto = ctx.autoAbove.get(s.id);
      if (auto) {
        ctx.bars.set(auto.id, { id: auto.id, row, col, colEnd: col, placement: "above" });
        auto.legs.forEach((leg, k) => {
          const src = auto.sources![k]!;
          const inFlow = isLegId(src) || ctx.transById.get(src)?.node.jump === undefined;
          ctx.legs.set(leg.id, { id: leg.id, branch: auto.id, col, colEnd: col, wired: !inFlow });
        });
        row++;
      }
      ctx.nodes.set(s.id, { id: s.id, kind: "step", row, col });
      row++;
    } else if (el.kind === "transition") {
      const t = ctx.transOf.get(el)!;
      ctx.nodes.set(t.id, { id: t.id, kind: "transition", row, col });
      row++;
    } else {
      const diverge = ctx.divergeOf.get(el)!;
      const barRow = row;
      row++;
      const ranges: Array<{ col: number; colEnd: number; end: number }> = [];
      let c = col;
      el.legs.forEach((leg) => {
        const res = placeSeq(ctx, leg, c, row);
        ranges.push({ col: c, colEnd: c + res.width - 1, end: res.row });
        c += res.width;
      });
      const lastCol = ranges[ranges.length - 1]!.col;
      width = Math.max(width, c - col);
      ctx.bars.set(diverge.id, { id: diverge.id, row: barRow, col, colEnd: lastCol, placement: "structural" });
      diverge.legs.forEach((leg, k) => {
        const r = ranges[k]!;
        ctx.legs.set(leg.id, { id: leg.id, branch: diverge.id, col: r.col, colEnd: r.colEnd, wired: false });
      });
      const endRow = Math.max(...ranges.map((r) => r.end));
      const converge = ctx.convergeOf.get(el);
      if (el.kind === "parallel") {
        ctx.bars.set(converge!.id, { id: converge!.id, row: endRow, col, colEnd: lastCol, placement: "structural" });
        converge!.legs.forEach((leg, k) => {
          const r = ranges[k]!;
          ctx.legs.set(leg.id, { id: leg.id, branch: converge!.id, col: r.col, colEnd: r.colEnd, wired: false });
        });
        row = endRow + 1;
      } else {
        // Map the last transition of each continuing leg to its column range.
        const legOfLast = new Map<GraphId, number>();
        el.legs.forEach((leg, k) => {
          const last = leg[leg.length - 1];
          if (last?.kind === "transition" && !last.jump) legOfLast.set(ctx.transOf.get(last)!.id, k);
        });
        if (converge) {
          const cont = converge.sources!.filter((s) => legOfLast.has(s)).map((s) => ranges[legOfLast.get(s)!]!.col);
          const colEnd = Math.max(col, ...cont);
          ctx.bars.set(converge.id, { id: converge.id, row: endRow, col, colEnd, placement: "structural" });
          converge.legs.forEach((leg, k) => {
            const k2 = legOfLast.get(converge.sources![k]!);
            const r = k2 === undefined ? undefined : ranges[k2]!;
            ctx.legs.set(leg.id, {
              id: leg.id,
              branch: converge.id,
              col: r ? r.col : colEnd,
              colEnd: r ? r.colEnd : colEnd,
              wired: r === undefined,
            });
          });
          row = endRow + 1;
        } else {
          const cont = continuingLegs(el);
          const k = cont.length === 1 ? el.legs.indexOf(cont[0]!) : -1;
          if (k > 0) {
            const last = cont[0]![cont[0]!.length - 1] as TransitionNode;
            const from = ctx.transOf.get(last)!.id;
            ctx.jogs.push({ from, row: endRow, stemCol: col, legCol: ranges[k]!.col, srcRow: ctx.nodes.get(from)!.row });
            row = endRow + 1;
          } else {
            row = endRow;
          }
        }
      }
    }
  }
  return { width, row };
}

/** Studio 5000 coordinates derived from the grid. */
export function l5xPositions(lay: Layout): L5XPositions {
  const colX: number[] = [];
  let x = L5X_ORIGIN_X;
  for (const c of lay.columns) {
    colX.push(x);
    x += c.kind === "element" ? L5X_COL_WIDTH : L5X_CHANNEL_WIDTH;
  }
  const hasStep = new Array<boolean>(lay.rows).fill(false);
  const hasNode = new Array<boolean>(lay.rows).fill(false);
  for (const n of lay.nodes.values()) {
    hasNode[n.row] = true;
    if (n.kind === "step") hasStep[n.row] = true;
  }
  const rowY: number[] = [];
  let y = L5X_ORIGIN_Y;
  for (let r = 0; r < lay.rows; r++) {
    if (r > 0) {
      y +=
        hasNode[r - 1] && hasNode[r] ? L5X_NODE_PITCH : hasStep[r - 1] ? L5X_STEP_BAR_PITCH : L5X_BAR_PITCH;
    }
    rowY.push(y);
  }
  const positions: L5XPositions = { nodes: new Map(), branches: new Map() };
  for (const n of lay.nodes.values()) positions.nodes.set(n.id, { x: colX[n.col]!, y: rowY[n.row]! });
  for (const b of lay.bars.values()) positions.branches.set(b.id, { y: rowY[b.row]! });
  return positions;
}
