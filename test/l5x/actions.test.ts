/** Several actions per step through lowering, layout and the L5X writer (SPEC §4.3, §8, Phase 4b). */
import { describe, expect, it } from "vitest";
import { actionBoxLines, compile, exportL5X } from "../../src/compile.js";
import { checkL5X, QUALIFIER_NAMES, writeL5X } from "../../src/l5x/index.js";
import { blockText, descendants, parseXml, type XmlElement } from "../../src/l5x/xml.js";
import { build, DATE } from "./helpers.js";

const src = (...lines: string[]): string => lines.join("\n");

const chart = src(
  "sfc qual",
  "init idle",
  "  reset ready",
  "-- start",
  'step fill 10s "Fill the tank"',
  "  on valve, pump",
  "  S",
  "    alarm := 1;",
  "  L 5s",
  "    horn [:=] 1;",
  "  D 2s",
  "    mixer [:=] 1;",
  "  P",
  "    n := n + 1;",
  "-- fill.DN",
  "step done",
  "  R",
  "    alarm := 0;",
  "  N",
  "    set ready",
  "-- ack -> idle",
);

const xml = (source: string): XmlElement => {
  const r = exportL5X(source, { fileName: "qual.qsfc", exportDate: DATE });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(checkL5X(r.text!)).toEqual([]);
  return parseXml(r.text!);
};
const stepEl = (root: XmlElement, operand: string): XmlElement =>
  descendants(root, "Step").find((s) => s.attrs["Operand"] === operand)!;
const actionsOf = (step: XmlElement): XmlElement[] => descendants(step, "Action");
const linesOf = (action: XmlElement): string[] => descendants(action, "Line").map(blockText);
const actionTag = (root: XmlElement, name: string): XmlElement =>
  descendants(root, "Tag").find((t) => t.attrs["Name"] === name)!;

describe("lower: actions", () => {
  const { graph } = compile(chart);

  it("keeps qualifiers, times and order, with the sugar expanded", () => {
    const fill = graph!.steps[1]!;
    expect(fill.actions.map((a) => [a.qualifier, a.timeMs, a.lines])).toEqual([
      ["N", undefined, ["valve [:=] 1; pump [:=] 1;"]],
      ["S", undefined, ["alarm := 1;"]],
      ["L", 5000, ["horn [:=] 1;"]],
      ["D", 2000, ["mixer [:=] 1;"]],
      ["P", undefined, ["n := n + 1;"]],
    ]);
  });

  it("numbers the action operands as the L5X writer does (a step takes at least one)", () => {
    expect(graph!.steps.map((s) => s.actions.map((a) => a.index))).toEqual([[0], [1, 2, 3, 4, 5], [6, 7]]);
    const noAction = compile(src("init a", "-- x", "step b", "  S", "    y := 1;", "  R", "    y := 0;", "-- z -> a")).graph!;
    expect(noAction.steps.map((s) => s.actions.map((a) => a.index))).toEqual([[], [1, 2]]);
  });

  it("continues the action numbers across routines", () => {
    const r = compile(src("sfc one", "init a", "  S", "    x := 1;", "  R", "    x := 0;", "-- go -> a", "sfc two", "init b", "  y [:=] 1;", "-- go2 -> b"));
    const two = r.routines.find((x) => x.name === "two")!.graph!;
    expect(two.steps[0]!.actions[0]!.index).toBe(2);
  });
});

describe("L5X: one <Action> per action", () => {
  const root = xml(chart);

  it("writes every action in source order with its qualifier word", () => {
    const fill = actionsOf(stepEl(root, "Step_001"));
    expect(fill.map((a) => a.attrs["Qualifier"])).toEqual(["NonStored", "StoredUntilReset", "TimeLimited", "TimeDelayed", "Pulse"]);
    expect(actionsOf(stepEl(root, "Step_002")).map((a) => a.attrs["Qualifier"])).toEqual(["Reset", "NonStored"]);
    for (const a of fill) expect(a.attrs["PresetUsesExpr"]).toBe("false");
  });

  it("uses the one qualifier table", () => {
    expect(QUALIFIER_NAMES).toEqual({
      N: "NonStored",
      S: "StoredUntilReset",
      R: "Reset",
      L: "TimeLimited",
      D: "TimeDelayed",
      P: "Pulse",
    });
  });

  it("allocates IDs right after the step, then after the previous action", () => {
    const step = stepEl(root, "Step_001");
    const id = Number(step.attrs["ID"]);
    expect(actionsOf(step).map((a) => Number(a.attrs["ID"]))).toEqual([id + 1, id + 2, id + 3, id + 4, id + 5]);
    const next = stepEl(root, "Step_002");
    expect(Number(next.attrs["ID"])).toBe(id + 6);
  });

  it("numbers the operands Action_000... across the program", () => {
    const all = descendants(root, "Action").map((a) => a.attrs["Operand"]);
    expect(all).toEqual(["Action_000", "Action_001", "Action_002", "Action_003", "Action_004", "Action_005", "Action_006", "Action_007"]);
  });

  it("puts the name comment in the first action only, whatever its qualifier", () => {
    const fill = actionsOf(stepEl(root, "Step_001"));
    expect(linesOf(fill[0]!)).toEqual(["// fill - Fill the tank", "valve [:=] 1; pump [:=] 1;"]);
    expect(linesOf(fill[1]!)).toEqual(["alarm := 1;"]);
    const done = actionsOf(stepEl(root, "Step_002"));
    expect(linesOf(done[0]!)).toEqual(["// done", "alarm := 0;"]);
    expect(linesOf(done[1]!)).toEqual(["ready := 1;"]);
  });

  it("a step without actions keeps its comment-only N action", () => {
    const r = xml(src("init a", "-- x", "step b", "  S", "    y := 1;", "-- z -> a"));
    const a = actionsOf(stepEl(r, "Step_000"));
    expect(a.map((x) => [x.attrs["Qualifier"], linesOf(x)])).toEqual([["NonStored", ["// a"]]]);
  });

  it("writes the action time as the PRE of the action tag (L5K second field)", () => {
    const tag = (name: string) => actionTag(root, name);
    const l5k = (name: string) => blockText(descendants(tag(name), "Data")[0]!);
    const pre = (name: string) => descendants(tag(name), "DataValueMember").find((m) => m.attrs["Name"] === "PRE")!.attrs["Value"];
    expect([l5k("Action_003"), pre("Action_003")]).toEqual(["[0,5000,0,0]", "5000"]);
    expect([l5k("Action_004"), pre("Action_004")]).toEqual(["[0,2000,0,0]", "2000"]);
    expect([l5k("Action_002"), pre("Action_002")]).toEqual(["[0,0,0,0]", "0"]);
  });

  it("rewrites step references in every action", () => {
    const r = xml(src("init a", "  x := 1;", "  P", "    n := a.T;", "-- a.DN -> a"));
    expect(linesOf(actionsOf(stepEl(r, "Step_000"))[1]!)).toEqual(["n := Step_000.T;"]);
  });

  it("without name comments, a step without actions has no <Action>", () => {
    const { graph, positions } = build(
      [
        { id: "s0", index: 0, x: 100, y: 100, initial: true },
        { id: "s1", index: 1, x: 100, y: 300, actions: [{ qualifier: "S", lines: ["y := 1;"] }, { qualifier: "L", timeMs: 3000, lines: ["z [:=] 1;"] }] },
      ],
      [
        { id: "t0", index: 0, x: 100, y: 200, condition: "go" },
        { id: "t1", index: 1, x: 100, y: 400, condition: "back" },
      ],
      [],
      [["s0", "t0"], ["t0", "s1"], ["s1", "t1"], ["t1", "s0"]],
    );
    const out = writeL5X(graph, positions, [], { programName: "P", routineName: "R", exportDate: DATE, nameComments: false });
    const r = parseXml(out);
    expect(actionsOf(stepEl(r, "Step_000"))).toEqual([]);
    const a = actionsOf(stepEl(r, "Step_001"));
    expect(a.map((x) => [x.attrs["Operand"], x.attrs["Qualifier"], linesOf(x)])).toEqual([
      ["Action_000", "StoredUntilReset", ["y := 1;"]],
      ["Action_001", "TimeLimited", ["z [:=] 1;"]],
    ]);
    expect(blockText(descendants(actionTag(r, "Action_001"), "Data")[0]!)).toBe("[0,3000,0,0]");
  });
});

describe("layout: room for stacked action boxes", () => {
  it("counts every action's lines, the name comment, and a header per extra action", () => {
    const g = compile(chart).graph!;
    expect(g.steps.map(actionBoxLines)).toEqual([2, 1 + 5 + 4, 1 + 2 + 1]);
    expect(actionBoxLines({ actions: [] })).toBe(1);
  });

  it("several actions push the next row further down than one action with the same lines", () => {
    const y = (source: string) => {
      const r = compile(source);
      const t = r.graph!.transitions[0]!;
      return r.positions!.nodes.get(t.id)!.y;
    };
    const one = y(src("init a", "  x1 := 1;", "  x2 := 1;", "  x3 := 1;", "  x4 := 1;", "  x5 := 1;", "-- go -> a"));
    const many = y(src("init a", "  x1 := 1;", "  S", "    x2 := 1;", "  R", "    x3 := 1;", "  P", "    x4 := 1;", "  N", "    x5 := 1;", "-- go -> a"));
    expect(many).toBeGreaterThan(one);
  });
});
