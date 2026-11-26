import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BranchNode, StepNode, TransitionNode } from "../../src/model/ast.js";
import { allSteps, allTransitions } from "../../src/model/ast.js";
import type { Diagnostic } from "../../src/model/diagnostics.js";
import { parse } from "../../src/parse/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const codes = (d: Diagnostic[]): string[] => d.map((x) => x.code);
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const only = (s: string, code: string): Diagnostic[] => parse(s).diagnostics.filter((d) => d.code === code);

describe("parse: first example (SPEC §2)", () => {
  const { chart, diagnostics } = parse(fixture("first-example.qsfc"));

  it("has no diagnostics", () => {
    expect(diagnostics).toEqual([]);
  });

  it("reads the header", () => {
    expect(chart.header?.text).toBe("fill_and_check");
    expect(chart.header?.span).toMatchObject({ line: 2, col: 5 });
  });

  it("builds the top-level sequence", () => {
    expect(chart.body.map((e) => e.kind)).toEqual(["step", "transition", "step", "transition", "step", "select"]);
    const idle = chart.body[0] as StepNode;
    expect(idle).toMatchObject({ initial: true, name: { text: "idle" } });
    expect(idle.action).toEqual([{ text: "motor := 0;", span: { line: 5, col: 3, endLine: 5, endCol: 14 } }]);
    const fill = chart.body[2] as StepNode;
    expect(fill).toMatchObject({ initial: false, presetMs: 5000, description: "Fill the tank" });
    expect(fill.span).toEqual({ line: 7, col: 1, endLine: 7, endCol: 29 });
  });

  it("builds the select legs with names and jumps", () => {
    const sel = chart.body[5] as BranchNode;
    expect(sel.kind).toBe("select");
    expect(sel.legs).toHaveLength(2);
    expect(sel.span.line).toBe(11);
    expect(sel.endSpan?.line).toBe(21);
    const [good, pack, packDone] = sel.legs[0]! as [TransitionNode, StepNode, TransitionNode];
    expect(good).toMatchObject({ name: { text: "good" }, auto: false, condition: { text: "quality_ok" } });
    expect(pack.action.map((a) => a.text)).toEqual(["packer [:=] 1;"]);
    expect(packDone).toMatchObject({ auto: true, condition: { text: "pack_done" }, jump: { text: "idle" } });
    const rejected = sel.legs[1]![2] as TransitionNode;
    expect(rejected).toMatchObject({ name: { text: "rejected" }, condition: { text: "reject_done" }, jump: { text: "idle" } });
  });

  it("auto-names unnamed transitions in file order", () => {
    expect(allTransitions(chart).map((t) => [t.name.text, t.auto])).toEqual([
      ["T1", true], ["T2", true], ["good", false], ["T3", true], ["bad", false], ["rejected", false],
    ]);
  });
});

describe("parse: lines", () => {
  it("accepts CRLF exactly like LF", () => {
    const lf = fixture("jumps.qsfc").replace(/\r\n/g, "\n");
    const a = parse(lf);
    const b = parse(lf.replace(/\n/g, "\r\n"));
    expect(b).toEqual(a);
    expect(b.diagnostics).toEqual([]);
  });

  it("keywords are case-insensitive and indentation is ignored", () => {
    const { chart, diagnostics } = parse(src("SFC x", "   INIT a", "\t\t-- go", "Step b", "SELECT", "-- c -> a", "|", "-- d -> b", "END"));
    expect(diagnostics).toEqual([]);
    expect(chart.header?.text).toBe("x");
    expect(chart.body.map((e) => e.kind)).toEqual(["step", "transition", "step", "select"]);
  });

  it("never throws, even on garbage", () => {
    const pieces = ["step", "init", "--", "->", "|", "end", "select", "parallel", '"', "'", "//", ":", "x", "5s", "\n", "\r\n", " ", "tag", "sfc", "@a(", "]]>"];
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 300; k++) {
      let s = "";
      const n = Math.floor(rnd() * 40);
      for (let i = 0; i < n; i++) s += pieces[Math.floor(rnd() * pieces.length)] + (rnd() < 0.5 ? " " : "");
      expect(() => parse(s)).not.toThrow();
      expect(parse(s).diagnostics.some((d) => d.code === "E000")).toBe(false);
    }
  });

  it("an empty file gives an empty chart", () => {
    expect(parse("")).toEqual({
      program: { routines: [], tagDecls: [] },
      chart: { tagDecls: [], body: [] },
      diagnostics: [],
    });
  });
});

describe("parse: comments (SPEC §3.3)", () => {
  it("drops comments on structure lines", () => {
    const { chart, diagnostics } = parse(src(
      "sfc c // routine",
      "init a 5s \"desc // not a comment\" // comment",
      "-- x // comment -> b",
      "step b",
      "-- y -> a // back",
    ));
    expect(diagnostics).toEqual([]);
    const a = chart.body[0] as StepNode;
    expect(a.description).toBe("desc // not a comment");
    const t = chart.body[1] as TransitionNode;
    expect(t.condition.text).toBe("x");
    expect(t.jump).toBeUndefined();
    expect((chart.body[3] as TransitionNode).jump?.text).toBe("a");
  });

  it("keeps comments on action lines, and // inside ST strings", () => {
    const { chart } = parse(src("init a", "  x := 1; // set x", "  msg := 'a // b';", "-- TRUE -> a"));
    expect((chart.body[0] as StepNode).action.map((a) => a.text)).toEqual(["x := 1; // set x", "msg := 'a // b';"]);
  });

  it("condition ends at // and -> outside strings", () => {
    const { chart } = parse(src("init a", "-- s = '->' OR t = '//x' -> a // c"));
    const t = chart.body[1] as TransitionNode;
    expect(t.condition.text).toBe("s = '->' OR t = '//x'");
    expect(t.jump?.text).toBe("a");
  });

  it("keeps comment-only lines inside an action, drops trailing ones", () => {
    const { chart } = parse(src("init a", "  // open the valve", "  valve := 1;", "  // trailing note", "", "-- TRUE -> a"));
    expect((chart.body[0] as StepNode).action.map((a) => a.text)).toEqual(["// open the valve", "valve := 1;"]);
  });

  it("comment lines outside a step are ignored (no E209)", () => {
    expect(parse(src("// top", "init a", "-- TRUE", "// between", "step b")).diagnostics).toEqual([]);
  });
});

describe("parse: actions (SPEC §4.3)", () => {
  it("dedents, keeps relative indentation and inner blank lines, drops outer blank lines", () => {
    const { chart } = parse(src(
      "init a",
      "",
      "    valve [:=] 1;",
      "    IF level > 80 THEN",
      "",
      "      alarm := 1;   ",
      "    END_IF;",
      "",
      "",
      "-- TRUE -> a",
    ));
    const a = chart.body[0] as StepNode;
    expect(a.action.map((x) => x.text)).toEqual(["valve [:=] 1;", "IF level > 80 THEN", "", "  alarm := 1;", "END_IF;"]);
    expect(a.action.map((x) => [x.span.line, x.span.col])).toEqual([[3, 5], [4, 5], [5, 1], [6, 5], [7, 5]]);
  });

  it("a step without action lines has no action", () => {
    const { chart } = parse(src("init a", "", "-- TRUE -> a"));
    expect((chart.body[0] as StepNode).action).toEqual([]);
  });

  it("actions at column 1 are fine", () => {
    const { chart, diagnostics } = parse(src("init a", "x := 1;", "-- TRUE -> a"));
    expect(diagnostics).toEqual([]);
    expect((chart.body[0] as StepNode).action[0]).toMatchObject({ text: "x := 1;", span: { line: 2, col: 1 } });
  });

  it("E209: action line after a transition, reported once per run", () => {
    const d = only(src("init a", "-- go", "  x := 1;", "  y := 1;", "step b"), "E209");
    expect(d).toHaveLength(1);
    expect(d[0]!.span).toMatchObject({ line: 3, col: 3 });
    expect(d[0]!.message).toContain("follows a transition");
  });

  it("E209: action line before the first step", () => {
    const d = only(src("x := 1;", "init a"), "E209");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("before the first step");
  });

  it("E209: action lines after `end` and after `select`", () => {
    const d = only(src("init a", "select", "  x := 1;", "  -- c -> a", "|", "  -- d -> a", "end", "  y := 1;"), "E209");
    expect(d.map((x) => x.span.line)).toEqual([3, 8]);
  });

  describe("E110 qualifier detection", () => {
    const e110 = (line: string): Diagnostic[] => only(src("init a", line, "-- TRUE -> a"), "E110");
    it.each(["L 10s horn [:=] 1;", "N {", "S count := count + 1;", "n      pusher [:=] 1;", "SD 2s x := 1;", "P1 x := 1;", "N;"])(
      "reports `%s`",
      (line) => {
        expect(e110(line)).toHaveLength(1);
      },
    );
    it.each(["S := 1;", "S [:=] 1;", "N.x := 1;", "P1[2] := 1;", "D(x);", "L = 1;", "S", "L < 3", "R: x", "N // comment", "Na := 1;", "IF S THEN"])(
      "accepts ST `%s`",
      (line) => {
        expect(e110(line)).toEqual([]);
      },
    );
    it("shows the qualifier and the duration", () => {
      expect(e110("L 10s horn [:=] 1;")[0]!.message).toBe(
        "action qualifiers are not supported yet: write the ST without `L 10s` (N is used)",
      );
    });
  });
});

describe("parse: steps (SPEC §4.2, §3.5, §3.6)", () => {
  it.each([
    ["5s", 5000], ["500ms", 500], ["1m30s", 90000], ["2h", 7200000], ["1h1m1s1ms", 3661001], ["10S", 10000],
  ])("duration %s = %i ms", (tok, ms) => {
    const { chart, diagnostics } = parse(`init a ${tok}`);
    expect(diagnostics).toEqual([]);
    expect((chart.body[0] as StepNode).presetMs).toBe(ms);
  });

  it("E104: number without unit", () => {
    const d = only("init a 5", "E104");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`5` has no unit: write `5s` or `5ms`");
    expect(d[0]!.span).toMatchObject({ line: 1, col: 8 });
    expect(only("init a 1m30", "E104")).toHaveLength(1);
  });

  it("E105: unknown unit, invalid form, too long", () => {
    expect(only("init a 30d", "E105")[0]!.message).toContain("unknown unit `d`");
    expect(only("init a 5s-", "E105")).toHaveLength(1);
    expect(only("init a 2147483647ms", "E105")).toEqual([]);
    expect(only("init a 2147483648ms", "E105")[0]!.message).toContain("too long");
    expect(only("init a 25d", "E105")).toHaveLength(1);
    expect(only("init a 597h", "E105")[0]!.message).toContain("too long");
  });

  it("description with escapes, without duration", () => {
    const { chart, diagnostics } = parse('step w "say \\"hi\\" \\\\ ok"');
    expect(diagnostics).toEqual([]);
    expect((chart.body[0] as StepNode).description).toBe('say "hi" \\ ok');
    expect((chart.body[0] as StepNode).presetMs).toBeUndefined();
  });

  it("E106: string not closed", () => {
    const { chart, diagnostics } = parse('init a 5s "never closed');
    expect(codes(diagnostics)).toEqual(["E106"]);
    expect((chart.body[0] as StepNode).description).toBe("never closed");
  });

  it("E109: ]]> in a description, an action or a condition", () => {
    const d = only(src('init a "x ]]> y"', "  s := 'a]]>';", "-- c = ']]>' -> a", 'tag t "]]>"'), "E109");
    expect(d.map((x) => [x.span.line, x.span.col])).toEqual([[1, 11], [2, 10], [3, 9], [4, 8]]);
  });

  it("E107: extra text after the step", () => {
    expect(only('init a 5s "d" extra', "E107")[0]!.message).toContain("`extra`");
    expect(only("init a extra words", "E107")).toHaveLength(1);
    expect(only('init a "d" 5s', "E107")).toHaveLength(1);
  });

  it("missing step name still creates a step", () => {
    const { chart, diagnostics } = parse(src("step", "  x := 1;"));
    expect(codes(diagnostics)).toEqual(["E101"]);
    expect(chart.body[0]).toMatchObject({ kind: "step", name: { text: "" } });
    expect((chart.body[0] as StepNode).action).toHaveLength(1);
  });
});

describe("parse: names (SPEC §3.4)", () => {
  it("E101: invalid start or characters", () => {
    expect(only("init 2fill", "E101")[0]!.message).toBe("`2fill` is not a valid name: names start with a letter or `_`");
    expect(only("init fill-a", "E101")).toHaveLength(1);
    expect(only("init fülle", "E101")).toHaveLength(1);
  });

  it("E102: more than 40 characters", () => {
    expect(only(`init ${"a".repeat(40)}`, "E102")).toEqual([]);
    expect(only(`init ${"a".repeat(43)}`, "E102")[0]!.message).toBe(`name \`${"a".repeat(43)}\` is 43 characters long; the maximum is 40`);
  });

  it("E103: double or trailing underscore", () => {
    expect(only("init fill__a", "E103")).toHaveLength(1);
    expect(only("init fill_", "E103")).toHaveLength(1);
    expect(only("init _fill", "E103")).toEqual([]);
  });

  it("E108: keywords", () => {
    expect(only("init select", "E108")[0]!.message).toBe("`select` is a keyword and can't be used as a name");
    expect(only("init And", "E108")).toHaveLength(1);
    expect(only("init a\n-- END_IF: x -> a", "E108")).toHaveLength(1);
  });

  it("E405: generated operand names for steps and transitions", () => {
    expect(only("init Step_003", "E405")[0]!.message).toBe("`Step_003` is a reserved name (used for generated operands)");
    expect(only("init a\n-- tran_1: x -> a", "E405")).toHaveLength(1);
    expect(only("init ACTION_12", "E405")).toHaveLength(1);
    expect(only("init Step_x", "E405")).toEqual([]);
  });
});

describe("parse: header and tags (SPEC §4.1, §7.4)", () => {
  it("header after comments and blank lines is fine", () => {
    expect(parse(src("// c", "", "sfc ok", "init a")).diagnostics).toEqual([]);
  });

  it("a later `sfc` header starts a second routine (SPEC §4.5)", () => {
    const { program, chart, diagnostics } = parse(src("init a", "-- x", "sfc late", "init b"));
    expect(diagnostics).toEqual([]);
    expect(program.routines.map((r) => [r.kind, r.name?.text])).toEqual([["sfc", undefined], ["sfc", "late"]]);
    expect(chart.header).toBeUndefined();
    expect(allSteps(chart).map((s) => s.name.text)).toEqual(["a"]);
  });

  it("E210: `program` after a routine, or twice", () => {
    expect(only(src("init a", "program late"), "E210")).toHaveLength(1);
    expect(only(src("program one", "program two", "init a"), "E210")).toHaveLength(1);
    const ok = parse(src("// c", "tag x : DINT", "program p", "sfc s", "init a"));
    expect(ok.diagnostics).toEqual([]);
    expect(ok.program.header?.text).toBe("p");
  });

  it("header name checks and extra text", () => {
    expect(only("sfc 1x", "E101")).toHaveLength(1);
    expect(only("sfc", "E101")).toHaveLength(1);
    expect(only("sfc a b", "E107")).toHaveLength(1);
  });

  it("tag lines with type and description", () => {
    const { chart, diagnostics } = parse(src('tag start_btn "Green push button"', "tag count : DINT", "tag tmr:timer", 'tag lvl : REAL "Level" // c'));
    expect(diagnostics).toEqual([]);
    expect(chart.tagDecls.map((d) => [d.name.text, d.type, d.description])).toEqual([
      ["start_btn", undefined, "Green push button"],
      ["count", "DINT", undefined],
      ["tmr", "TIMER", undefined],
      ["lvl", "REAL", "Level"],
    ]);
    expect(chart.tagDecls[1]!.name.span).toMatchObject({ line: 2, col: 5 });
  });

  it("E409: unknown or missing type leaves type absent", () => {
    const { chart, diagnostics } = parse(src("tag t : TMR", "tag u :", "tag v : COUNTER"));
    expect(codes(diagnostics)).toEqual(["E409", "E409", "E409"]);
    expect(diagnostics[0]!.message).toBe("unknown type `TMR` (Phase 1 types: BOOL, DINT, REAL, TIMER)");
    expect(chart.tagDecls.every((d) => d.type === undefined)).toBe(true);
  });

  it("tag line name checks and extra text", () => {
    expect(only("tag 9x", "E101")).toHaveLength(1);
    expect(only("tag", "E101")).toHaveLength(1);
    expect(only("tag x : BOOL junk", "E107")).toHaveLength(1);
  });

  it("a tag line ends the action block", () => {
    const d = parse(src("init a", "tag x", "  y := 1;"));
    expect(codes(d.diagnostics)).toEqual(["E209"]);
  });
});

describe("parse: transitions (SPEC §4.4)", () => {
  const t = (line: string): TransitionNode => parse(src("init a", line)).chart.body[1] as TransitionNode;

  it("detects the name, not := or [:=]", () => {
    expect(t("-- start: start_btn AND ok")).toMatchObject({ name: { text: "start", span: { line: 2, col: 4 } }, auto: false, condition: { text: "start_btn AND ok", span: { line: 2, col: 11 } } });
    expect(t("-- x := 1")).toMatchObject({ auto: true, condition: { text: "x := 1" } });
    expect(t("--   n1  :  fill.DN")).toMatchObject({ name: { text: "n1" }, condition: { text: "fill.DN" } });
    expect(t("--fill.DN")).toMatchObject({ auto: true, condition: { text: "fill.DN", span: { col: 3 } } });
  });

  it("jump target and its span", () => {
    expect(t("-- done: count >= 10 -> idle")).toMatchObject({ condition: { text: "count >= 10" }, jump: { text: "idle", span: { line: 2, col: 25 } } });
    expect(t("-- TRUE->idle").jump?.text).toBe("idle");
  });

  it("an empty condition still parses", () => {
    const { chart, diagnostics } = parse(src("init a", "--", "step b", "-- n: -> a"));
    expect(diagnostics).toEqual([]);
    expect((chart.body[1] as TransitionNode).condition.text).toBe("");
    expect((chart.body[3] as TransitionNode)).toMatchObject({ name: { text: "n" }, condition: { text: "" }, jump: { text: "a" } });
  });

  it("E219: text after the jump target", () => {
    const d = only(src("init a", "-- x -> idle now"), "E219");
    expect(d[0]!.message).toBe("unexpected text `now` after the jump target `idle`");
    expect(d[0]!.span).toMatchObject({ line: 2, col: 14 });
    expect(only(src("init a", "-- x -> idle;"), "E219")).toHaveLength(1);
  });

  it("E101: missing or invalid jump target", () => {
    expect(only(src("init a", "-- x ->"), "E101")[0]!.message).toContain("missing jump target");
    expect(only(src("init a", "-- x -> 2nd"), "E101")).toHaveLength(1);
  });

  it("auto names skip names used anywhere (case-insensitive)", () => {
    const { chart } = parse(src(
      "tag t2 : BOOL",
      "init T1",
      "  t3 := 1;",
      "-- a",
      "step b",
      "-- T4: x",
      "step c",
      "-- y",
      "step d",
      "-- z -> t1",
    ));
    expect(allTransitions(chart).map((x) => x.name.text)).toEqual(["T5", "T4", "T6", "T7"]);
  });

  it("identifiers in strings do not block auto names", () => {
    const { chart } = parse(src("init a", "  m := 'T1';", "-- TRUE -> a"));
    expect(allTransitions(chart)[0]!.name.text).toBe("T1");
  });
});

describe("parse: blocks (SPEC §5)", () => {
  it("builds nested legs (select inside parallel)", () => {
    const { chart, diagnostics } = parse(fixture("nested-select-in-parallel.qsfc"));
    expect(diagnostics).toEqual([]);
    const par = chart.body.find((e) => e.kind === "parallel") as BranchNode;
    expect(par.legs.map((l) => l.map((e) => e.kind))).toEqual([
      ["step", "transition", "step"],
      ["step", "select", "step"],
    ]);
    const sel = par.legs[1]![1] as BranchNode;
    expect(sel.legs.map((l) => l.length)).toEqual([1, 3]);
    expect(sel.endSpan?.line).toBe(18);
  });

  it("builds nested legs (parallel inside select)", () => {
    const { chart, diagnostics } = parse(fixture("nested-parallel-in-select.qsfc"));
    expect(diagnostics).toEqual([]);
    const sel = chart.body[1] as BranchNode;
    expect(sel.legs[0]!.map((e) => e.kind)).toEqual(["transition", "step", "transition", "parallel", "transition"]);
  });

  it("E204: | outside a block", () => {
    const d = only(src("init a", "|"), "E204");
    expect(d[0]!.span).toMatchObject({ line: 2, col: 1 });
  });

  it("E205: end without a block", () => {
    expect(only(src("init a", "  end"), "E205")[0]!.span).toMatchObject({ line: 2, col: 3 });
  });

  it("E206: block never closed, reported at its start line", () => {
    const { chart, diagnostics } = parse(src("init a", "select", "  -- x -> a", "|", "  parallel", "    step q"));
    const d = diagnostics.filter((x) => x.code === "E206");
    expect(d.map((x) => x.span.line)).toEqual([2, 5]);
    expect(d[0]!.message).toBe("`select` at line 2 is never closed: add `end`");
    const sel = chart.body[1] as BranchNode;
    expect(sel.endSpan).toBeUndefined();
    expect(sel.legs).toHaveLength(2);
  });

  it("empty legs are kept for the validator", () => {
    const { chart } = parse(src("init a", "select", "|", "end"));
    expect((chart.body[1] as BranchNode).legs).toEqual([[], []]);
  });

  it("E107: text after select / | / end", () => {
    expect(codes(parse(src("init a", "select x", "| y", "end z")).diagnostics)).toEqual(["E107", "E107", "E107"]);
  });
});

describe("parse: version 1 detection (E100)", () => {
  it.each(["SI@idle(motor:=0;)", "S@fill(valve:=1;, 5000)", "T@start(start_btn)", "  s@x(y)", "/\\", "\\/", "//\\\\", "\\\\//", "-- done -> @idle", "x := @foo(1);"])(
    "detects `%s`",
    (line) => {
      expect(codes(parse(line).diagnostics)).toEqual(["E100"]);
    },
  );

  it("does not flag @ inside strings", () => {
    expect(parse(src('init a "mail @x(y)"', "  s := '@f(1)';")).diagnostics).toEqual([]);
  });

  it("reports every v1 line of the fixture", () => {
    const { chart, diagnostics } = parse(fixture("invalid-v1.qsfc"));
    expect(codes(diagnostics)).toEqual(["E100", "E100", "E100", "E100"]);
    expect(chart.body).toEqual([]);
  });
});

describe("parse: recovery", () => {
  it("reports several errors at once and keeps building", () => {
    const { chart, diagnostics } = parse(src(
      "  stray := 1;",
      "init 2bad 5",
      "-- x -> a b",
      "step ok 30d",
      "|",
      "end",
      'step good "unclosed',
      "sfc late",
    ));
    expect(codes(diagnostics)).toEqual(["E209", "E101", "E104", "E219", "E105", "E204", "E205", "E106"]);
    expect(allSteps(chart).map((s) => s.name.text)).toEqual(["2bad", "ok", "good"]);
  });

  it("all valid fixtures parse without diagnostics", () => {
    for (const f of ["first-example", "chains", "linear", "select", "select-skip", "parallel", "nested-select-in-parallel", "nested-parallel-in-select", "parallel-loop", "jumps"]) {
      expect(parse(fixture(`${f}.qsfc`)).diagnostics, f).toEqual([]);
    }
  });

  it("diagnostics are sorted by position", () => {
    const d = parse(fixture("invalid-structure.qsfc")).diagnostics;
    const keys = d.map((x) => x.span.line * 1000 + x.span.col);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });
});
