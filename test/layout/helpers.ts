import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import type { Chart } from "../../src/model/ast.js";
import type { Graph } from "../../src/model/graph.js";
import { parse } from "../../src/parse/index.js";
import { validate } from "../../src/validate/index.js";
import { lower } from "../../src/lower/index.js";
import { layout, type Layout } from "../../src/layout/index.js";

export interface Built {
  chart: Chart;
  graph: Graph;
  layout: Layout;
}

export function build(source: string): Built {
  const { chart, diagnostics } = parse(source);
  const errors = [...diagnostics, ...validate(chart)].filter((d) => d.severity === "error");
  expect(errors, "no errors before layout").toEqual([]);
  const graph = lower(chart);
  return { chart, graph, layout: layout(graph, chart) };
}

const fixturesDir = new URL("../fixtures/", import.meta.url);
const testpackDir = new URL("../../testpack/", import.meta.url);

/** Every valid chart: test/fixtures (except invalid-*) and testpack/. */
export function validCharts(): Array<{ name: string; source: string }> {
  const list = (dir: URL, prefix: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".qsfc") && !f.startsWith("invalid"))
      .sort()
      .map((f) => ({ name: `${prefix}${f.replace(/\.qsfc$/, "")}`, source: readFileSync(new URL(f, dir), "utf8") }));
  return [...list(fixturesDir, ""), ...list(testpackDir, "testpack/")];
}

export function chartSource(name: string): string {
  const c = validCharts().find((x) => x.name === name);
  if (!c) throw new Error(`no chart ${name}`);
  return c.source;
}

/** Node id by step / transition name. */
export function idOf(g: Graph, name: string): string {
  const s = g.steps.find((x) => x.name === name);
  if (s) return s.id;
  const t = g.transitions.find((x) => x.name === name);
  if (t) return t.id;
  throw new Error(`no element ${name}`);
}

/** Edge cases not covered by the fixtures (all valid charts). */
export const syntheticCharts: Array<{ name: string; source: string }> = [
  {
    // A jump from a middle select leg back to the chain head: its way down is blocked
    // by the select's own convergence, so it reaches the loop-back bar by a wire.
    name: "synthetic/middle-leg-loop",
    source: [
      "init idle", "-- start", "step a", "select", "  -- x", "  step b", "  -- bdone", "|",
      "  -- y -> idle", "|", "  -- z", "end", "step c", "-- cdone -> idle",
    ].join("\n"),
  },
  {
    // Three chains, jumps between them, a jog inside a leg, a select whose legs all jump.
    name: "synthetic/chains-and-jogs",
    source: [
      "init idle", "-- go -> work", "step fault", "-- ack -> work", "step work", "select",
      "  -- f1 -> fault", "|", "  -- ok", "  step more", "  select", "    -- again -> work", "  |",
      "    -- fin", "  end", "  step last", "  -- back -> idle", "end",
    ].join("\n"),
  },
  {
    // Parallel in parallel, and a loop to the first step of a parallel leg.
    name: "synthetic/parallel-in-parallel",
    source: [
      "init idle", "-- go", "parallel", "  step a1", "  select", "    -- r1 -> a1", "  |", "    -- n1",
      "  end", "  step a2", "|", "  step b1", "  -- bgo", "  parallel", "    step c1", "  |", "    step c2",
      "    -- c2go", "    step c3", "  end", "  -- cdone", "  step b2", "end", "-- alldone -> idle",
    ].join("\n"),
  },
  {
    // Every leg of the last select jumps; two of them to the initial step.
    name: "synthetic/all-legs-jump",
    source: [
      "init idle", "-- go", "step a 1m30s", "select", "  -- j1 -> idle", "|", "  -- j2 -> a", "|",
      "  -- j3 -> idle", "end",
    ].join("\n"),
  },
];
