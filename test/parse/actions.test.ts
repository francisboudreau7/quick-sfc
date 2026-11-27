/** Several actions per step, qualifiers and output sugar (SPEC §4.3, Phase 4b). */
import { describe, expect, it } from "vitest";
import { actionLineText, type StepNode } from "../../src/model/ast.js";
import type { Diagnostic } from "../../src/model/diagnostics.js";
import { parse } from "../../src/parse/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const only = (s: string, code: string): Diagnostic[] => parse(s).diagnostics.filter((d) => d.code === code);
const firstStep = (s: string): StepNode => parse(s).chart.body[0] as StepNode;

describe("parse: qualifier lines start actions", () => {
  const text = src(
    "init fill",
    "  valve [:=] 1;",
    "  S",
    "    alarm := 1;",
    "  l 10s   // horn",
    "    horn [:=] 1;",
    "",
    "    horn2 [:=] 1;",
    "  D 1m30s",
    "    mixer [:=] 1;",
    "  P",
    "    count := count + 1;",
    "  R",
    "    alarm := 0;",
    "  N",
    "    lamp [:=] 1;",
    "-- TRUE -> fill",
  );

  it("splits the lines into actions in source order, with qualifiers and durations", () => {
    const { chart, diagnostics } = parse(text);
    expect(diagnostics).toEqual([]);
    const step = chart.body[0] as StepNode;
    expect(step.actions.map((a) => [a.qualifier, a.timeMs])).toEqual([
      ["N", undefined], ["S", undefined], ["L", 10000], ["D", 90000], ["P", undefined], ["R", undefined], ["N", undefined],
    ]);
    expect(step.actions.map((a) => a.lines.map((l) => l.text))).toEqual([
      ["valve [:=] 1;"], ["alarm := 1;"], ["horn [:=] 1;", "", "horn2 [:=] 1;"], ["mixer [:=] 1;"],
      ["count := count + 1;"], ["alarm := 0;"], ["lamp [:=] 1;"],
    ]);
  });

  it("keeps spans: the implicit N action has no header, the others point at their qualifier line", () => {
    const step = firstStep(text);
    expect(step.actions[0]!.header).toBeUndefined();
    expect(step.actions[0]!.span).toMatchObject({ line: 2, col: 3 });
    expect(step.actions[1]!.header).toMatchObject({ line: 3, col: 3, endCol: 4 });
    expect(step.actions[2]!.header).toMatchObject({ line: 5, col: 3 });
    // dedent per action: the lines of S start at their own indentation
    expect(step.actions[1]!.lines[0]!.span).toMatchObject({ line: 4, col: 5 });
  });

  it("`action` still lists every line of every action (qualifier lines excluded)", () => {
    const step = firstStep(text);
    expect(step.action.map((l) => l.span.line)).toEqual([2, 4, 6, 7, 8, 10, 12, 14, 16]);
  });

  it("a step whose first line is a qualifier has no implicit N action", () => {
    const step = firstStep(src("init a", "  S", "    x := 1;", "-- TRUE -> a"));
    expect(step.actions.map((a) => a.qualifier)).toEqual(["S"]);
  });

  it("comment lines before the first qualifier line make no action", () => {
    const step = firstStep(src("init a", "  // just a note", "  P", "    x := 1;", "-- TRUE -> a"));
    expect(step.actions.map((a) => a.qualifier)).toEqual(["P"]);
  });

  it("indentation is cosmetic: qualifier lines and their ST at the same column", () => {
    const step = firstStep(src("init a", "S", "x := 1;", "R", "x := 0;", "-- TRUE -> a"));
    expect(step.actions.map((a) => [a.qualifier, a.lines[0]!.text])).toEqual([["S", "x := 1;"], ["R", "x := 0;"]]);
  });

  it("a one-action chart keeps a single N action", () => {
    const step = firstStep(src("init a", "  x := 1;", "  y := 2;", "-- TRUE -> a"));
    expect(step.actions).toHaveLength(1);
    expect(step.actions[0]).toMatchObject({ qualifier: "N", lines: [{ text: "x := 1;" }, { text: "y := 2;" }] });
  });

  it.each(["S := 1;", "S [:=] 1;", "N.x := 1;", "L = 1;", "IF S THEN", "Na := 1;", "P1[2] := 1;"])(
    "`%s` is ST, not a qualifier line",
    (line) => {
      const step = firstStep(src("init a", `  ${line}`, "-- TRUE -> a"));
      expect(step.actions.map((a) => a.qualifier)).toEqual(["N"]);
      expect(step.actions[0]!.lines[0]!.text).toBe(line);
    },
  );
});

describe("parse: E110, E111, E112", () => {
  it.each(["P0", "P1", "SL 5s", "sd 2s", "DS 1s"])("E110: `%s` is not supported yet", (q) => {
    const d = only(src("init a", `  ${q}`, "    x := 1;", "-- TRUE -> a"), "E110");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe(`qualifier \`${q.split(" ")[0]!.toUpperCase()}\` is not supported yet (N, S, R, L, D, P are)`);
    expect(d[0]!.span).toMatchObject({ line: 2, col: 3 });
  });

  it("E110: a qualifier with ST on the same line must go on its own line", () => {
    const d = only(src("init a", "  S x := 1;", "-- TRUE -> a"), "E110");
    expect(d.map((x) => x.message)).toEqual(["write the qualifier `S` on its own line, with the action's ST on the lines below it"]);
    expect(only(src("init a", "  SL 5s x := 1;", "-- TRUE -> a"), "E110")[0]!.message).toContain("`SL` is not supported yet");
  });

  it.each(["L", "D", "l // comment"])("E111: `%s` needs a duration", (q) => {
    const d = only(src("init a", `  ${q}`, "    x := 1;", "-- TRUE -> a"), "E111");
    expect(d).toHaveLength(1);
    const letter = q[0]!.toUpperCase();
    expect(d[0]!.message).toBe(`qualifier \`${letter}\` needs a duration: \`${letter} 10s\``);
    expect(d[0]!.span).toMatchObject({ line: 2, col: 3, endCol: 4 });
  });

  it.each(["N 5s", "S 5s", "R 1s", "P 2s"])("E111: `%s` takes no duration", (q) => {
    const d = only(src("init a", `  ${q}`, "    x := 1;", "-- TRUE -> a"), "E111");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe(`qualifier \`${q[0]}\` takes no duration`);
    expect(d[0]!.span).toMatchObject({ line: 2, col: 5, endCol: q.length + 3 });
  });

  it("a bad duration on L or D is reported like a step duration (E104/E105)", () => {
    expect(only(src("init a", "  L 5", "    x := 1;", "-- TRUE -> a"), "E104")).toHaveLength(1);
    expect(only(src("init a", "  D 5x", "    x := 1;", "-- TRUE -> a"), "E105")).toHaveLength(1);
  });

  it("E112: a qualifier line with no ST under it", () => {
    const d = only(src("init fill", "  x := 1;", "  S", "  // only a comment", "  L 5s", "    y := 1;", "  P", "-- TRUE -> fill"), "E112");
    expect(d.map((x) => [x.span.line, x.message])).toEqual([
      [3, "the `S` action of step `fill` is empty"],
      [7, "the `P` action of step `fill` is empty"],
    ]);
  });

  it("no E112 for an unsupported qualifier (E110 is enough)", () => {
    const { diagnostics } = parse(src("init a", "  P1", "-- TRUE -> a"));
    expect(diagnostics.map((d) => d.code)).toEqual(["E110"]);
  });

  it("a qualifier line with no step above is an orphan action line (E209)", () => {
    expect(only(src("S", "  x := 1;", "init a", "-- TRUE -> a"), "E209")).toHaveLength(1);
  });
});

describe("parse: output sugar", () => {
  it.each([
    ["on valve", "on", ["valve"], "valve [:=] 1;"],
    ["on valve, pump;", "on", ["valve", "pump"], "valve [:=] 1; pump [:=] 1;"],
    ["SET alarm", "set", ["alarm"], "alarm := 1;"],
    ["set a,b ;", "set", ["a", "b"], "a := 1; b := 1;"],
    ["reset alarm, horn // off", "reset", ["alarm", "horn"], "alarm := 0; horn := 0; // off"],
  ])("`%s` is sugar", (line, verb, names, expanded) => {
    const step = firstStep(src("init a", `  ${line}`, "-- TRUE -> a"));
    const l = step.actions[0]!.lines[0]!;
    expect(l.text).toBe(line);
    expect(l.sugar?.verb).toBe(verb);
    expect(l.sugar?.names.map((n) => n.text)).toEqual(names);
    expect(actionLineText(l)).toBe(expanded);
  });

  it("name spans point at the names in the file", () => {
    const step = firstStep(src("init a", "    on valve,  pump", "-- TRUE -> a"));
    expect(step.actions[0]!.lines[0]!.sugar!.names.map((n) => n.span)).toEqual([
      { line: 2, col: 8, endLine: 2, endCol: 13 },
      { line: 2, col: 16, endLine: 2, endCol: 20 },
    ]);
  });

  it.each(["set := 1;", "on := 0;", "reset", "reset x y", "set x := 1;", "on x.DN", "set x,", "on(x);", "onx", "set x; y := 1;"])(
    "`%s` is ordinary ST",
    (line) => {
      const step = firstStep(src("init a", `  ${line}`, "-- TRUE -> a"));
      const l = step.actions[0]!.lines[0]!;
      expect(l.sugar).toBeUndefined();
      expect(actionLineText(l)).toBe(line);
    },
  );

  it("works in every action, not only N", () => {
    const step = firstStep(src("init a", "  S", "    set alarm", "  R", "    reset alarm", "-- TRUE -> a"));
    expect(step.actions.map((a) => actionLineText(a.lines[0]!))).toEqual(["alarm := 1;", "alarm := 0;"]);
  });

  it("is not sugar in an ST routine", () => {
    const { program } = parse(src("st main", "  set alarm"));
    const r = program.routines[0]!;
    expect(r.kind === "st" && r.body[0]).toMatchObject({ text: "set alarm" });
    expect(r.kind === "st" && "sugar" in r.body[0]!).toBe(false);
  });
});
