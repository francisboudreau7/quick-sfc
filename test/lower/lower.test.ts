import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lower } from "../../src/lower/index.js";
import type { Graph } from "../../src/model/graph.js";
import { parse } from "../../src/parse/index.js";
import { validate } from "../../src/validate/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

function build(s: string): Graph {
  const { chart, diagnostics } = parse(s);
  const all = [...diagnostics, ...validate(chart)].filter((d) => d.severity === "error");
  expect(all, "no errors before lowering").toEqual([]);
  return lower(chart);
}

/** Links as "from>to", checked as an exact set (and without duplicates). */
function expectLinks(g: Graph, expected: string): void {
  const got = g.links.map((l) => `${l.from}>${l.to}`);
  expect(new Set(got).size, "no duplicate links").toBe(got.length);
  expect([...got].sort()).toEqual(expected.trim().split(/\s+/).sort());
}

/** Branches as "id:type/flow[target](sources)". */
const branchSummary = (g: Graph): string[] =>
  g.branches.map((b) =>
    `${b.id}:${b.type}/${b.flow}${b.target ? `@${b.target}` : ""}${b.sources ? `(${b.sources.join(",")})` : ""}#${b.legs.map((l) => l.id).join(",")}`,
  );

/** Every step has at most one incoming link, every element at most one outgoing (except branches/legs). */
function checkWellFormed(g: Graph): void {
  const into = new Map<string, number>();
  const outOf = new Map<string, number>();
  for (const l of g.links) {
    into.set(l.to, (into.get(l.to) ?? 0) + 1);
    outOf.set(l.from, (outOf.get(l.from) ?? 0) + 1);
  }
  for (const s of g.steps) expect(into.get(s.id) ?? 0, `incoming of ${s.id}`).toBeLessThanOrEqual(1);
  for (const t of g.transitions) {
    expect(into.get(t.id), `incoming of ${t.id}`).toBe(1);
    expect(outOf.get(t.id), `outgoing of ${t.id}`).toBe(1);
  }
  for (const b of g.branches) {
    for (const leg of b.legs) {
      const n = (into.get(leg.id) ?? 0) + (outOf.get(leg.id) ?? 0);
      expect(n, `leg ${leg.id} is connected`).toBe(1);
    }
    if (b.flow === "converge") expect(b.legs.length).toBeGreaterThanOrEqual(2);
  }
}

describe("lower: elements", () => {
  it("numbers steps and transitions in file order with their data", () => {
    const g = build(fixture("first-example.qsfc"));
    expect(g.steps.map((s) => [s.id, s.index, s.name, s.initial, s.presetMs])).toEqual([
      ["s0", 0, "idle", true, 0],
      ["s1", 1, "fill", false, 5000],
      ["s2", 2, "check", false, 0],
      ["s3", 3, "pack", false, 0],
      ["s4", 4, "reject", false, 0],
    ]);
    expect(g.steps[1]!.description).toBe("Fill the tank");
    expect(g.steps[0]!.description).toBeUndefined();
    expect(g.steps[1]!.action).toEqual(["valve [:=] 1;"]);
    expect(g.steps[2]!.action).toEqual([]);
    expect(g.transitions.map((t) => [t.id, t.index, t.name, t.auto, t.condition])).toEqual([
      ["t0", 0, "T1", true, "start_btn AND safety_ok"],
      ["t1", 1, "T2", true, "fill.DN"],
      ["t2", 2, "good", false, "quality_ok"],
      ["t3", 3, "T3", true, "pack_done"],
      ["t4", 4, "bad", false, "NOT quality_ok"],
      ["t5", 5, "rejected", false, "reject_done"],
    ]);
    expect(g.steps[0]!.node.name.text).toBe("idle");
    expect(g.transitions[2]!.node.name.text).toBe("good");
  });

  it("keeps multi-line actions raw", () => {
    const g = build(fixture("linear.qsfc"));
    expect(g.steps[1]!.action).toEqual(["motor := 1;", "IF level > 80 THEN", "  alarm := 1;", "END_IF;"]);
  });

  it("is deterministic", () => {
    const s = fixture("jumps.qsfc");
    const a = lower(parse(s).chart);
    const b = lower(parse(s).chart);
    expect(JSON.stringify({ ...a, steps: a.steps.map((x) => x.id) })).toBe(JSON.stringify({ ...b, steps: b.steps.map((x) => x.id) }));
    expect(a.links).toEqual(b.links);
    expect(branchSummary(a)).toEqual(branchSummary(b));
  });
});

describe("lower: fixtures (exact links)", () => {
  it("linear", () => {
    const g = build(fixture("linear.qsfc"));
    expect(g.branches).toEqual([]);
    expectLinks(g, "s0>t0 t0>s1 s1>t1 t1>s0");
  });

  it("chains (§6.3): each step has one incoming jump or flow", () => {
    const g = build(fixture("chains.qsfc"));
    // s0 idle, s1 error, s2 work; t0 start->work, t1 reset->idle, t2 fault->error
    expect(g.branches).toEqual([]);
    expectLinks(g, "s0>t0 t0>s2 s1>t1 t1>s0 s2>t2 t2>s1");
  });

  it("first example (§2): auto convergence on the initial step from 2 jumps", () => {
    const g = build(fixture("first-example.qsfc"));
    expect(branchSummary(g)).toEqual([
      "b0:selection/converge@s0(t3,t5)#b0.0,b0.1",
      "b1:selection/diverge#b1.0,b1.1",
    ]);
    expect(g.branches[0]!.node).toBeUndefined();
    expect(g.branches[1]!.node?.kind).toBe("select");
    expectLinks(g, `
      s0>t0 t0>s1 s1>t1 t1>s2
      s2>b1 b1.0>t2 t2>s3 s3>t3 b1.1>t4 t4>s4 s4>t5
      t3>b0.0 t5>b0.1 b0>s0
    `);
    checkWellFormed(g);
  });

  it("select (§5.1)", () => {
    const g = build(fixture("select.qsfc"));
    expect(branchSummary(g)).toEqual([
      "b0:selection/diverge#b0.0,b0.1",
      "b1:selection/converge(t1,t3)#b1.0,b1.1",
    ]);
    expect(g.branches[1]!.node).toBe(g.branches[0]!.node);
    expectLinks(g, "s0>b0 b0.0>t0 t0>s1 s1>t1 b0.1>t2 t2>s2 s2>t3 t1>b1.0 t3>b1.1 b1>s3 s3>t4 t4>s0");
    checkWellFormed(g);
  });

  it("select with a skip leg (§5.1)", () => {
    const g = build(fixture("select-skip.qsfc"));
    expect(branchSummary(g)).toEqual([
      "b0:selection/diverge#b0.0,b0.1",
      "b1:selection/converge(t1,t3)#b1.0,b1.1",
    ]);
    expectLinks(g, "s0>t0 t0>s1 s1>b0 b0.0>t1 b0.1>t2 t2>s2 s2>t3 t1>b1.0 t3>b1.1 b1>s3 s3>t4 t4>s0");
    checkWellFormed(g);
  });

  it("parallel (§5.2)", () => {
    const g = build(fixture("parallel.qsfc"));
    expect(branchSummary(g)).toEqual([
      "b0:simultaneous/diverge#b0.0,b0.1",
      "b1:simultaneous/converge(s2,s3)#b1.0,b1.1",
    ]);
    expectLinks(g, "s0>t0 t0>b0 b0.0>s1 s1>t1 t1>s2 b0.1>s3 s2>b1.0 s3>b1.1 b1>t2 t2>s4 s4>t3 t3>s0");
    checkWellFormed(g);
  });

  it("select inside parallel (§5.3)", () => {
    const g = build(fixture("nested-select-in-parallel.qsfc"));
    // s0 idle s1 fill_a s2 done_a s3 fill_b s4 alarm_b s5 done_b s6 mix
    // t0 start t1 fill_a.DN t2 level_b t3 fault_b t4 ack_btn t5 TRUE t6 mix_done
    expect(branchSummary(g)).toEqual([
      "b0:simultaneous/diverge#b0.0,b0.1",
      "b1:selection/diverge#b1.0,b1.1",
      "b2:selection/converge(t2,t4)#b2.0,b2.1",
      "b3:simultaneous/converge(s2,s5)#b3.0,b3.1",
    ]);
    expectLinks(g, `
      s0>t0 t0>b0 b0.0>s1 s1>t1 t1>s2
      b0.1>s3 s3>b1 b1.0>t2 b1.1>t3 t3>s4 s4>t4 t2>b2.0 t4>b2.1 b2>s5
      s2>b3.0 s5>b3.1 b3>t5 t5>s6 s6>t6 t6>s0
    `);
    checkWellFormed(g);
  });

  it("parallel inside select", () => {
    const g = build(fixture("nested-parallel-in-select.qsfc"));
    // s0 idle s1 prepare s2 heat s3 hold s4 stir s5 manual s6 finish
    // t0 auto_mode t1 ready t2 heat.DN t3 stir_done t4 manual_mode t5 manual_done t6 finish_ack
    expect(branchSummary(g)).toEqual([
      "b0:selection/diverge#b0.0,b0.1",
      "b1:simultaneous/diverge#b1.0,b1.1",
      "b2:simultaneous/converge(s3,s4)#b2.0,b2.1",
      "b3:selection/converge(t3,t5)#b3.0,b3.1",
    ]);
    expectLinks(g, `
      s0>b0 b0.0>t0 t0>s1 s1>t1 t1>b1 b1.0>s2 s2>t2 t2>s3 b1.1>s4 s3>b2.0 s4>b2.1 b2>t3
      b0.1>t4 t4>s5 s5>t5 t3>b3.0 t5>b3.1 b3>s6 s6>t6 t6>s0
    `);
    checkWellFormed(g);
  });

  it("loop inside a parallel leg via a nested select (§6.2)", () => {
    const g = build(fixture("parallel-loop.qsfc"));
    // s0 idle s1 prepare_a s2 fill_a s3 done_a s4 fill_b s5 done_b
    // t0 start t1 go_a t2 retry->fill_a t3 level_ok t4 level_b t5 all_done->idle
    expect(branchSummary(g)).toEqual([
      "b0:simultaneous/diverge#b0.0,b0.1",
      "b1:selection/converge@s2(t1,t2)#b1.0,b1.1",
      "b2:selection/diverge#b2.0,b2.1",
      "b3:simultaneous/converge(s3,s5)#b3.0,b3.1",
    ]);
    // the nested select has only one continuing leg: level_ok links straight to done_a
    expectLinks(g, `
      s0>t0 t0>b0 b0.0>s1 s1>t1 t1>b1.0 t2>b1.1 b1>s2 s2>b2 b2.0>t2 b2.1>t3 t3>s3
      b0.1>s4 s4>t4 t4>s5 s3>b3.0 s5>b3.1 b3>t5 t5>s0
    `);
    checkWellFormed(g);
  });

  it("jumps and automatic convergence (§6.4)", () => {
    const g = build(fixture("jumps.qsfc"));
    // s0 idle s1 fill s2 check s3 pack s4 reject s5 store s6 finish
    // t0 T1 t1 T2 t2 good t3 T3 t4 bad t5 retry t6 skip t7 more t8 full t9 T4 t10 again
    expect(branchSummary(g)).toEqual([
      "b0:selection/converge@s1(t0,t5,t7)#b0.0,b0.1,b0.2",
      "b1:selection/diverge#b1.0,b1.1,b1.2",
      "b2:selection/converge(t3,t6,t10)#b2.0,b2.1,b2.2",
      "b3:selection/diverge#b3.0,b3.1",
      "b4:selection/diverge#b4.0,b4.1",
    ]);
    // store's convergence is the explicit select's, with the jump `again` as an extra leg
    expect(g.branches[2]!.node).toBe(g.branches[1]!.node);
    expectLinks(g, `
      s0>t0 t0>b0.0 t5>b0.1 t7>b0.2 b0>s1 s1>t1 t1>s2
      s2>b1 b1.0>t2 t2>s3 s3>t3 b1.1>t4 t4>s4 s4>t5 b1.2>t6
      t3>b2.0 t6>b2.1 t10>b2.2 b2>s5
      s5>b3 b3.0>t7 b3.1>t8 t8>s6
      s6>b4 b4.0>t9 b4.1>t10 t9>s0
    `);
    checkWellFormed(g);
  });
});

describe("lower: convergence rules", () => {
  it("a select with one continuing leg links that transition straight to the next step", () => {
    const g = build(src(
      "init idle", "-- start",
      "step work",
      "select", "  -- fault -> error", "|", "  -- done_sig", "end",
      "step unload", "-- unloaded -> idle",
      "step error", "-- reset -> idle",
    ));
    // s0 idle s1 work s2 unload s3 error; t0 start t1 fault t2 done_sig t3 unloaded t4 reset
    expect(branchSummary(g)).toEqual([
      "b0:selection/converge@s0(t3,t4)#b0.0,b0.1",
      "b1:selection/diverge#b1.0,b1.1",
    ]);
    expectLinks(g, "s0>t0 t0>s1 s1>b1 b1.0>t1 b1.1>t2 t2>s2 s2>t3 t1>s3 s3>t4 t3>b0.0 t4>b0.1 b0>s0");
    checkWellFormed(g);
  });

  it("a single continuing leg plus a jump to the convergence step makes a 2-leg converge on the select", () => {
    const g = build(src(
      "init idle",
      "select", "  -- a -> other", "|", "  -- b", "end",
      "step next", "-- n -> idle",
      "step other", "-- o -> next",
    ));
    // s0 idle s1 next s2 other; t0 a t1 b t2 n t3 o
    expect(branchSummary(g)).toEqual([
      "b0:selection/diverge#b0.0,b0.1",
      "b1:selection/converge(t1,t3)#b1.0,b1.1",
    ]);
    expect(g.branches[1]!.node).toBe(g.branches[0]!.node);
    expectLinks(g, "s0>b0 b0.0>t0 b0.1>t1 t1>b1.0 t3>b1.1 b1>s1 s1>t2 t2>s0 t0>s2 s2>t3");
    checkWellFormed(g);
  });

  it("normal flow plus a jump makes an automatic converge", () => {
    const g = build(src("init a", "-- x", "step b", "-- y -> b"));
    expect(branchSummary(g)).toEqual(["b0:selection/converge@s1(t0,t1)#b0.0,b0.1"]);
    expectLinks(g, "s0>t0 t0>b0.0 t1>b0.1 b0>s1 s1>t1");
  });

  it("a single jump into a step is a direct link", () => {
    const g = build(src("init a", "-- x -> b", "step b", "-- y -> a"));
    expect(g.branches).toEqual([]);
    expectLinks(g, "s0>t0 t0>s1 s1>t1 t1>s0");
  });

  it("jump into a select leg", () => {
    const g = build(src(
      "init a",
      "select", "  -- x", "  step b", "  -- y", "|", "  -- z", "end",
      "step c", "-- back -> b",
    ));
    // s0 a s1 b s2 c; t0 x t1 y t2 z t3 back
    expect(branchSummary(g)).toEqual([
      "b0:selection/diverge#b0.0,b0.1",
      "b1:selection/converge@s1(t0,t3)#b1.0,b1.1",
      "b2:selection/converge(t1,t2)#b2.0,b2.1",
    ]);
    expectLinks(g, "s0>b0 b0.0>t0 t0>b1.0 t3>b1.1 b1>s1 s1>t1 b0.1>t2 t1>b2.0 t2>b2.1 b2>s2 s2>t3");
    checkWellFormed(g);
  });

  it("auto convergence on the initial step from 2 jumps, ordered by the target line", () => {
    const g = build(src(
      "init a", "-- go", "step b",
      "select", "  -- p -> a", "|", "  -- q -> a", "end",
    ));
    expect(branchSummary(g)).toEqual([
      "b0:selection/converge@s0(t1,t2)#b0.0,b0.1",
      "b1:selection/diverge#b1.0,b1.1",
    ]);
    expectLinks(g, "s0>t0 t0>s1 s1>b1 b1.0>t1 b1.1>t2 t1>b0.0 t2>b0.1 b0>s0");
  });

  it("loop to the first step of a parallel leg: the diverge leg feeds an automatic converge", () => {
    const g = build(src(
      "init a", "-- go",
      "parallel",
      "  step fill_a",
      "  select", "    -- retry -> fill_a", "  |", "    -- ok", "  end",
      "  step done_a",
      "|",
      "  step b",
      "end",
      "-- all -> a",
    ));
    // s0 a s1 fill_a s2 done_a s3 b; t0 go t1 retry t2 ok t3 all
    expect(branchSummary(g)).toEqual([
      "b0:simultaneous/diverge#b0.0,b0.1",
      "b1:selection/converge@s1(b0.0,t1)#b1.0,b1.1",
      "b2:selection/diverge#b2.0,b2.1",
      "b3:simultaneous/converge(s2,s3)#b3.0,b3.1",
    ]);
    expectLinks(g, "s0>t0 t0>b0 b0.0>b1.0 t1>b1.1 b1>s1 s1>b2 b2.0>t1 b2.1>t2 t2>s2 b0.1>s3 s2>b3.0 s3>b3.1 b3>t3 t3>s0");
  });

  it("three-leg parallel with an action-less leg", () => {
    const g = build(src(
      "init a", "-- go",
      "parallel", "  step p", "|", "  step q", "  -- qq", "  step q2", "|", "  step r", "end",
      "-- join -> a",
    ));
    expect(branchSummary(g)).toEqual([
      "b0:simultaneous/diverge#b0.0,b0.1,b0.2",
      "b1:simultaneous/converge(s1,s3,s4)#b1.0,b1.1,b1.2",
    ]);
    expectLinks(g, "s0>t0 t0>b0 b0.0>s1 b0.1>s2 s2>t1 t1>s3 b0.2>s4 s1>b1.0 s3>b1.1 s4>b1.2 b1>t2 t2>s0");
    checkWellFormed(g);
  });

  it("a chart that ends on a step (W300) lowers without an outgoing link", () => {
    const { chart } = parse(src("init a", "-- x", "step done"));
    const g = lower(chart);
    expectLinks(g, "s0>t0 t0>s1");
  });
});
