import { describe, expect, it } from "vitest";
import { walk } from "../../src/model/ast.js";
import type { Graph, GraphId } from "../../src/model/graph.js";
import {
  L5X_BAR_PITCH,
  L5X_NODE_PITCH,
  layout,
  l5xPositions,
  type Layout,
} from "../../src/layout/index.js";
import { build, chartSource, idOf, syntheticCharts, validCharts, type Built } from "./helpers.js";

const charts = [...validCharts(), ...syntheticCharts];

/** Every grid cell taken by an element: nodes, bars (over their whole span), jogs. */
function occupancy(lay: Layout): Map<string, string[]> {
  const cells = new Map<string, string[]>();
  const take = (r: number, c: number, who: string): void => {
    const k = `${r},${c}`;
    cells.set(k, [...(cells.get(k) ?? []), who]);
  };
  for (const n of lay.nodes.values()) take(n.row, n.col, n.id);
  for (const b of lay.bars.values()) for (let c = b.col; c <= b.colEnd; c++) take(b.row, c, b.id);
  for (const w of lay.wires) {
    if (w.kind !== "jog") continue;
    const r = w.points[1]!.row;
    const [c0, c1] = [w.points[1]!.col, w.points[2]!.col].sort((a, b) => a - b);
    for (let c = c0!; c <= c1!; c++) take(r, c, `jog:${w.from}`);
  }
  return cells;
}

const byCondition = (g: Graph, cond: string): GraphId[] =>
  g.transitions.filter((t) => t.condition === cond).map((t) => t.id);

describe.each(charts)("layout guarantees: $name", ({ source }) => {
  const built: Built = build(source);
  const { graph, chart, layout: lay } = built;

  it("places every step, transition, branch and leg", () => {
    for (const s of graph.steps) expect(lay.nodes.get(s.id)?.kind, s.id).toBe("step");
    for (const t of graph.transitions) expect(lay.nodes.get(t.id)?.kind, t.id).toBe("transition");
    for (const b of graph.branches) {
      expect(lay.bars.has(b.id), b.id).toBe(true);
      for (const leg of b.legs) expect(lay.legs.get(leg.id)?.branch, leg.id).toBe(b.id);
    }
    expect(lay.nodes.size).toBe(graph.steps.length + graph.transitions.length);
    expect(lay.bars.size).toBe(graph.branches.length);
  });

  it("puts nothing on top of anything else", () => {
    for (const [cell, who] of occupancy(lay)) expect(who, `cell ${cell}`).toHaveLength(1);
    for (const n of lay.nodes.values()) {
      expect(lay.columns[n.col]?.kind, `${n.id} in an element column`).toBe("element");
      expect(n.row).toBeGreaterThanOrEqual(0);
      expect(n.row).toBeLessThan(lay.rows);
    }
    for (const b of lay.bars.values()) {
      expect(b.colEnd).toBeGreaterThanOrEqual(b.col);
      expect(b.row).toBeLessThan(lay.rows);
    }
  });

  it("keeps every leg's elements inside the leg's column range and between its bars", () => {
    for (const b of graph.branches) {
      if (!b.node || b.flow !== "diverge") continue;
      const bar = lay.bars.get(b.id)!;
      const converge = graph.branches.find((x) => x.node === b.node && x.flow === "converge");
      const end = converge ? lay.bars.get(converge.id)!.row : Infinity;
      b.node.legs.forEach((leg, k) => {
        const place = lay.legs.get(b.legs[k]!.id)!;
        for (const el of walk(leg)) {
          if (el.kind === "select" || el.kind === "parallel") continue;
          const g = el.kind === "step" ? graph.steps.find((s) => s.node === el)! : graph.transitions.find((t) => t.node === el)!;
          const n = lay.nodes.get(g.id)!;
          expect(n.col, `${g.id} in leg ${place.id}`).toBeGreaterThanOrEqual(place.col);
          expect(n.col, `${g.id} in leg ${place.id}`).toBeLessThanOrEqual(place.colEnd);
          expect(n.row).toBeGreaterThan(bar.row);
          expect(n.row).toBeLessThan(end);
        }
      });
      // Legs side by side, without overlapping.
      const places = b.legs.map((l) => lay.legs.get(l.id)!);
      for (let k = 1; k < places.length; k++) expect(places[k]!.col).toBe(places[k - 1]!.colEnd + 1);
      expect(bar.col).toBe(places[0]!.col);
      expect(bar.colEnd).toBe(places[places.length - 1]!.col);
    }
    expect(chart.body.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const again = build(source);
    expect(again.layout).toEqual(lay);
    expect(layout(graph, chart)).toEqual(lay);
    expect(l5xPositions(again.layout)).toEqual(l5xPositions(lay));
  });

  it("brings the element after a convergence back to the branch's first column", () => {
    for (const b of graph.branches) {
      if (b.flow !== "converge" || !b.node) continue;
      const bar = lay.bars.get(b.id)!;
      for (const l of graph.links.filter((x) => x.from === b.id)) expect(lay.nodes.get(l.to)!.col).toBe(bar.col);
    }
  });

  it("routes wires orthogonally, through channels, never across an element", () => {
    const occ = occupancy(lay);
    for (const w of lay.wires) {
      for (let k = 1; k < w.points.length; k++) {
        const a = w.points[k - 1]!;
        const b = w.points[k]!;
        expect(a.row === b.row || a.col === b.col, `${w.kind} ${w.from}->${w.to} orthogonal`).toBe(true);
        if (a.col === b.col && w.kind !== "jog") {
          // Vertical: in a channel column, or a half-row stub at an end.
          const long = Math.abs(a.row - b.row) > 0.5;
          if (long) expect(lay.columns[a.col]?.kind, `${w.from}->${w.to} channel`).toBe("channel");
        } else if (a.row === b.row && w.kind !== "jog") {
          expect(Number.isInteger(a.row), "horizontal wire segments run between rows").toBe(false);
        }
        if (a.col === b.col) {
          for (let r = Math.ceil(Math.min(a.row, b.row)); r <= Math.floor(Math.max(a.row, b.row)); r++) {
            const who = occ.get(`${r},${a.col}`) ?? [];
            const allowed = [w.from, w.to, ...(lay.legs.has(w.to) ? [lay.legs.get(w.to)!.branch] : []), `jog:${w.from}`];
            for (const x of who) expect(allowed, `${w.kind} ${w.from}->${w.to} crosses ${x}`).toContain(x);
          }
        }
      }
    }
  });

  it("gives every jump a wire, and nothing else", () => {
    const jumpTo = graph.links.filter((l) => graph.transitions.find((t) => t.id === l.from)?.node.jump);
    for (const l of jumpTo) {
      const leg = lay.legs.get(l.to);
      if (leg && !leg.wired) continue; // vertical into a convergence placed below its sources
      expect(lay.wires.some((w) => w.from === l.from && w.to === l.to), `${l.from}->${l.to}`).toBe(true);
    }
  });

  it("produces realistic, positive integer L5X coordinates", () => {
    const pos = l5xPositions(lay);
    expect(pos.nodes.size).toBe(graph.steps.length + graph.transitions.length);
    expect(pos.branches.size).toBe(graph.branches.length);
    const seen = new Set<string>();
    for (const [id, p] of pos.nodes) {
      for (const v of [p.x, p.y]) {
        expect(Number.isInteger(v), id).toBe(true);
        expect(v, id).toBeGreaterThan(0);
      }
      expect(seen.has(`${p.x},${p.y}`), `${id} has its own position`).toBe(false);
      seen.add(`${p.x},${p.y}`);
    }
    for (const [id, b] of pos.branches) {
      expect(Number.isInteger(b.y), id).toBe(true);
      expect(b.y, id).toBeGreaterThan(0);
    }
    const yOf = (id: GraphId): number => pos.nodes.get(id)?.y ?? pos.branches.get(id)!.y;
    // Plain links (step <-> transition, same column): 80..240 apart.
    for (const l of graph.links) {
      const a = lay.nodes.get(l.from);
      const b = lay.nodes.get(l.to);
      if (!a || !b || a.col !== b.col || graph.transitions.find((t) => t.id === l.from)?.node.jump) continue;
      const dy = yOf(l.to) - yOf(l.from);
      expect(dy, `${l.from}->${l.to}`).toBeGreaterThanOrEqual(80);
      expect(dy, `${l.from}->${l.to}`).toBeLessThanOrEqual(240);
    }
    // Bars: 60..240 from the element on their stem.
    for (const b of graph.branches) {
      if (b.flow === "diverge") {
        const into = graph.links.find((l) => l.to === b.id)!;
        const dy = yOf(b.id) - yOf(into.from);
        expect(dy, b.id).toBeGreaterThanOrEqual(L5X_BAR_PITCH);
        expect(dy, b.id).toBeLessThanOrEqual(240);
      } else {
        const out = graph.links.find((l) => l.from === b.id)!;
        const dy = yOf(out.to) - yOf(b.id);
        // loops: below the sources (dy < 0), or right above the target when every source is in
        // the target's chain (dy = L5X_BAR_PITCH)
        if (lay.bars.get(b.id)!.placement === "loop") expect(dy < 0 || dy === L5X_BAR_PITCH, b.id).toBe(true);
        else {
          expect(dy, b.id).toBeGreaterThanOrEqual(L5X_BAR_PITCH);
          expect(dy, b.id).toBeLessThanOrEqual(240);
        }
      }
      // Legs of one bar: 200..300+ apart, left to right.
      const xs = b.legs.map((l) => lay.legs.get(l.id)!).filter((l) => !l.wired);
      for (let k = 1; k < xs.length; k++) {
        const x0 = l5x(lay, xs[k - 1]!.col);
        const x1 = l5x(lay, xs[k]!.col);
        if (b.node) expect(x1 - x0, b.id).toBeGreaterThanOrEqual(200);
        else expect(x1).toBeGreaterThan(x0);
      }
    }
  });
});

/** L5X x of a grid column (via a node in that column, or computed like l5xPositions). */
function l5x(lay: Layout, col: number): number {
  let x = 200;
  for (let c = 0; c < col; c++) x += lay.columns[c]!.kind === "element" ? 300 : 60;
  return x;
}

describe("layout structure", () => {
  it("lays a linear chart down one column", () => {
    const { graph, layout: lay } = build(chartSource("linear"));
    const rows = ["idle", "T1", "run", "T2"].map((n) => lay.nodes.get(idOf(graph, n))!);
    expect(rows.map((n) => [n.row, n.col])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(lay.columns.map((c) => c.kind)).toEqual(["element", "channel"]);
    expect(lay.wires.map((w) => w.kind)).toEqual(["jump"]);
  });

  it("matches the verified Test_Parallel spacing", () => {
    const { graph, layout: lay } = build(chartSource("parallel"));
    const pos = l5xPositions(lay);
    const p = (n: string) => pos.nodes.get(idOf(graph, n))!;
    expect(p("idle")).toEqual({ x: 200, y: 100 });
    expect(p("T1")).toEqual({ x: 200, y: 100 + L5X_NODE_PITCH });
    expect(pos.branches.get("b0")).toEqual({ y: 280 });
    expect(p("fill_a")).toEqual({ x: 200, y: 340 });
    expect(p("fill_b")).toEqual({ x: 500, y: 340 });
    // Converge 100 below the lowest step, next transition 60 below the bar.
    expect(p("wait_a").y).toBe(580);
    expect(pos.branches.get("b1")).toEqual({ y: 680 });
    expect(p("T3")).toEqual({ x: 200, y: 740 });
  });

  it("places legs side by side, each as wide as its content", () => {
    const { graph, layout: lay } = build(chartSource("testpack/tp04_nested"));
    const col = (n: string) => lay.nodes.get(idOf(graph, n))!.col;
    expect(col("fill_a")).toBe(0);
    expect(col("alarm_a")).toBe(1); // nested select in leg A widens it to 2 columns
    expect(col("fill_b")).toBe(2);
    expect(col("left")).toBe(0);
    expect(col("right")).toBe(1);
    expect(col("manual_run")).toBe(2);
    expect(col("finish")).toBe(0);
    const outer = graph.branches.find((b) => b.type === "simultaneous" && b.flow === "diverge")!;
    expect(outer.legs.map((l) => [lay.legs.get(l.id)!.col, lay.legs.get(l.id)!.colEnd])).toEqual([[0, 1], [2, 2]]);
  });

  it("puts later chains in new column groups, top-aligned, right of everything", () => {
    const { graph, layout: lay } = build(chartSource("chains"));
    expect(lay.groups.map((g) => g.head)).toEqual([idOf(graph, "idle"), idOf(graph, "error"), idOf(graph, "work")]);
    const heads = lay.groups.map((g) => lay.nodes.get(g.head)!);
    expect(heads.map((h) => h.row)).toEqual([0, 0, 0]);
    expect(heads[0]!.col).toBeLessThan(heads[1]!.col);
    expect(heads[1]!.col).toBeLessThan(heads[2]!.col);
    for (let g = 1; g < lay.groups.length; g++) expect(lay.groups[g]!.col).toBeGreaterThan(lay.groups[g - 1]!.colEnd);
  });

  it("puts a loop-back convergence just below its lowest source (tp05)", () => {
    const { graph, layout: lay } = build(chartSource("testpack/tp05_jumps"));
    const auto = graph.branches.find((b) => b.target === idOf(graph, "idle"))!;
    const bar = lay.bars.get(auto.id)!;
    expect(bar.placement).toBe("loop");
    const unload = lay.nodes.get(byCondition(graph, "unload.DN")[0]!)!;
    const reset = lay.nodes.get(byCondition(graph, "reset_btn")[0]!)!;
    expect(bar.row).toBe(unload.row + 1);
    expect([bar.col, bar.colEnd]).toEqual([unload.col, reset.col]);
    const loop = lay.wires.find((w) => w.kind === "loop")!;
    expect(loop.from).toBe(auto.id);
    expect(loop.to).toBe(idOf(graph, "idle"));
    expect(loop.points[0]).toEqual({ row: bar.row, col: bar.col });
    expect(loop.points[loop.points.length - 1]).toEqual({ row: 0, col: 0 });
    // The error chain is a second group; the fault jump is wired to it.
    expect(lay.nodes.get(idOf(graph, "error"))).toMatchObject({ row: 0 });
    expect(lay.wires.find((w) => w.kind === "jump")!.to).toBe(idOf(graph, "error"));
    // Only leg 2 continues: a jog back to the branch column, no convergence bar.
    const jog = lay.wires.find((w) => w.kind === "jog")!;
    expect(jog.from).toBe(byCondition(graph, "done_sig")[0]);
    expect(jog.to).toBe(idOf(graph, "unload"));
    expect(lay.nodes.get(idOf(graph, "unload"))!.col).toBe(0);
  });

  it("puts a loop-back bar right above its target when every source is in the target's chain", () => {
    const { graph, layout: lay } = build(chartSource("testpack/tp09_stress_loops"));
    const pos = l5xPositions(lay);
    const idle = idOf(graph, "idle");
    const auto = graph.branches.find((b) => b.target === idle)!;
    expect(lay.bars.get(auto.id)!.placement).toBe("loop");
    expect(pos.branches.get(auto.id)!.y).toBe(pos.nodes.get(idle)!.y - 60);
  });

  it("keeps a loop-back bar 60 below the lowest source when a source is in another chain (reference export)", () => {
    const { graph, layout: lay } = build(chartSource("testpack/tp05_jumps"));
    const pos = l5xPositions(lay);
    const auto = graph.branches.find((b) => b.target === idOf(graph, "idle"))!;
    expect(lay.bars.get(auto.id)!.placement).toBe("loop");
    const lowest = Math.max(...auto.sources!.map((s) => pos.nodes.get(s)!.y));
    expect(pos.branches.get(auto.id)!.y).toBe(lowest + 60);
  });

  it("puts an automatic convergence with an in-flow source right above its target", () => {
    const { graph, layout: lay } = build(chartSource("jumps"));
    const fill = lay.nodes.get(idOf(graph, "fill"))!;
    const auto = graph.branches.find((b) => b.target === idOf(graph, "fill"))!;
    const bar = lay.bars.get(auto.id)!;
    expect(bar).toMatchObject({ placement: "above", row: fill.row - 1, col: fill.col, colEnd: fill.col });
    expect(lay.nodes.get(byCondition(graph, "start_btn")[0]!)!.row).toBe(fill.row - 2);
    const wired = auto.legs.map((l) => lay.legs.get(l.id)!.wired);
    expect(wired).toEqual([false, true, true]); // start_btn above; retry and more are jumps
    expect(lay.wires.filter((w) => w.kind === "jump-leg").map((w) => w.from)).toEqual(
      expect.arrayContaining([idOf(graph, "retry"), idOf(graph, "more"), idOf(graph, "again")]),
    );
  });

  it("puts the convergence at the top of a parallel leg (tp07)", () => {
    const { graph, layout: lay } = build(chartSource("testpack/tp07_leg_loop"));
    const auto = graph.branches.find((b) => b.target === idOf(graph, "fill_a"))!;
    const bar = lay.bars.get(auto.id)!;
    const diverge = graph.branches.find((b) => b.type === "simultaneous" && b.flow === "diverge")!;
    expect(bar.placement).toBe("above");
    expect(bar.row).toBe(lay.bars.get(diverge.id)!.row + 1);
    expect(lay.nodes.get(idOf(graph, "fill_a"))!.row).toBe(bar.row + 1);
  });

  it("wires a jump whose way down to the loop-back bar is blocked", () => {
    const { graph, layout: lay } = build(syntheticCharts[0]!.source);
    const auto = graph.branches.find((b) => b.target === idOf(graph, "idle"))!;
    const legs = auto.legs.map((l) => lay.legs.get(l.id)!);
    expect(legs.map((l) => l.wired)).toEqual([true, false]); // y (middle leg) wired, cdone straight down
    const bar = lay.bars.get(auto.id)!;
    expect(bar.row).toBe(lay.nodes.get(byCondition(graph, "cdone")[0]!)!.row + 1);
    expect(lay.wires.find((w) => w.kind === "jump-leg")!.from).toBe(byCondition(graph, "y")[0]);
  });

  it("gives jumps into an explicit convergence a wired extra leg", () => {
    const { graph, layout: lay } = build(chartSource("jumps"));
    const store = idOf(graph, "store");
    const conv = graph.branches.find((b) => b.flow === "converge" && graph.links.some((l) => l.from === b.id && l.to === store))!;
    expect(conv.node).toBeDefined();
    const legs = conv.legs.map((l) => lay.legs.get(l.id)!);
    expect(legs.map((l) => l.wired)).toEqual([false, false, true]);
    const bar = lay.bars.get(conv.id)!;
    expect(bar.colEnd).toBe(2); // spans the skip leg, the jumping retry leg is in between
    expect(legs[2]!.col).toBe(bar.colEnd);
  });
});
