import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/model/diagnostics.js";
import { parse } from "../../src/parse/index.js";
import { validate } from "../../src/validate/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const check = (s: string): Diagnostic[] => {
  const { chart, diagnostics } = parse(s);
  expect(diagnostics, "parse diagnostics").toEqual([]);
  return validate(chart);
};
const codes = (s: string): string[] => check(s).map((d) => d.code);
const one = (s: string, code: string): Diagnostic => {
  const d = check(s).filter((x) => x.code === code);
  expect(d, `${code} in ${JSON.stringify(check(s).map((x) => x.code))}`).toHaveLength(1);
  return d[0]!;
};

const VALID = [
  "first-example", "chains", "linear", "select", "select-skip", "parallel",
  "nested-select-in-parallel", "nested-parallel-in-select", "parallel-loop", "jumps",
];

describe("validate: fixtures", () => {
  it.each(VALID)("%s is valid with no warnings", (f) => {
    expect(check(fixture(`${f}.qsfc`))).toEqual([]);
  });

  it("invalid-structure reports several problems at once", () => {
    const { chart } = parse(fixture("invalid-structure.qsfc"));
    expect(validate(chart).map((d) => d.code)).toEqual(["E202", "E203", "E303", "E306", "E207", "E213", "E214"]);
  });

  it("never throws on parser output for broken input", () => {
    for (const s of ["", "|", "end", "select\n|\nend", "-- a\n-- b", "parallel\nselect\nend", "init\n--\n->", "step a\nselect\n  parallel\n  step x"]) {
      expect(() => validate(parse(s).chart)).not.toThrow();
    }
  });
});

describe("validate: alternation (SPEC §5.3)", () => {
  it("E200: no steps", () => {
    expect(validate(parse("// nothing").chart).map((d) => d.code)).toEqual(["E200"]);
  });

  it("E201: chain starts with a transition", () => {
    expect(one(src("-- x", "init a", "-- TRUE -> a"), "E201").span.line).toBe(1);
    const d = one(src("init a", "-- x -> a", "-- y", "step b", "-- z -> a"), "E201");
    expect(d.span.line).toBe(3);
    expect(d.hint).toContain("jump at line 2");
  });

  it("E202: two steps in a row", () => {
    const d = one(src("init fill 5s", "step check", "-- TRUE -> fill"), "E202");
    expect(d.message).toBe("two steps in a row: `fill` (line 1) and `check`");
    expect(d.hint).toBe("add a transition between them, e.g.  -- fill.DN");
    expect(d.span.line).toBe(2);
  });

  it("E203: two transitions in a row", () => {
    const d = one(src("init a", "-- x", "-- y", "step b", "-- z -> a"), "E203");
    expect(d.message).toBe("two transitions in a row: `T1` (line 2) and `T2`");
  });

  it("E211: select after a transition or at a chain start", () => {
    one(src("init a", "-- x", "select", "  -- y -> a", "|", "  -- z -> a", "end"), "E211");
    one(src("select", "  -- y", "|", "  -- z", "end", "init a", "-- q -> a"), "E211");
  });

  it("E215: parallel after a step or at a chain start", () => {
    one(src("init a", "parallel", "  step b", "|", "  step c", "end", "-- x -> a"), "E215");
    one(src("init a", "-- x -> a", "parallel", "  step b", "|", "  step c", "end", "-- y -> a"), "E215");
  });

  it("E214: something other than a step after a select end", () => {
    one(src("init a", "select", "  -- x", "|", "  -- y", "end", "-- z -> a"), "E214");
    // a parallel after a select end (alternation OK, but needs an actual step)
    one(src("init a", "select", "  -- x", "|", "  -- y", "end", "parallel", "  step b", "|", "  step c", "end", "-- z -> a"), "E214");
    // at the end of the file
    expect(one(src("init a", "select", "  -- x", "|", "  -- y -> a", "end"), "E214").span.line).toBe(6);
  });

  it("E218: something other than a transition after a parallel end", () => {
    one(src("init a", "-- go", "parallel", "  step b", "|", "  step c", "end", "step d", "-- x -> a"), "E218");
    // a select after a parallel end (alternation OK, but needs an actual transition)
    one(src("init a", "-- go", "parallel", "  step b", "|", "  step c", "end", "select", "  -- x -> a", "|", "  -- y -> a", "end"), "E218");
    one(src("init a", "-- go", "parallel", "  step b", "|", "  step c", "end"), "E218");
  });

  it("select after select needs a step in between", () => {
    expect(codes(src("init a", "select", "  -- x", "|", "  -- y", "end", "select", "  -- p -> a", "|", "  -- q -> a", "end"))).toContain("E214");
  });

  it("parallel after parallel needs a transition in between", () => {
    expect(codes(src(
      "init a", "-- go",
      "parallel", "  step b", "|", "  step c", "end",
      "parallel", "  step d", "|", "  step e", "end",
      "-- x -> a",
    ))).toContain("E218");
  });
});

describe("validate: branch shapes (SPEC §5)", () => {
  it("E207: fewer than 2 legs", () => {
    expect(one(src("init a", "select", "  -- x -> a", "end"), "E207").message).toContain("has 1");
  });

  it("E208: empty leg", () => {
    const d = one(src("init a", "select", "  -- x -> a", "|", "end"), "E208");
    expect(d.message).toContain("between `|` and `end`");
    expect(one(src("init a", "select", "|", "  -- x -> a", "end"), "E208").message).toContain("leg 1");
  });

  it("E212: select leg must start with a transition", () => {
    const d = one(src("init a", "select", "  -- x -> a", "|", "  step b", "  -- y -> a", "end"), "E212");
    expect(d.message).toBe("each `select` leg must start with a transition (`-- condition`); leg 2 starts with step `b`");
  });

  it("E213: select leg must end with a transition", () => {
    const d = one(src("init a", "select", "  -- x -> a", "|", "  -- y", "  step reject", "end", "step c", "-- z -> a"), "E213");
    expect(d.message).toBe("each `select` leg must end with a transition; leg 2 ends with step `reject`");
  });

  it("E216: parallel leg must start with a step", () => {
    one(src("init a", "-- go", "parallel", "  step b", "|", "  -- t", "  step c", "end", "-- x -> a"), "E216");
  });

  it("E217: parallel leg must end with a step", () => {
    one(src("init a", "-- go", "parallel", "  step b", "|", "  step c", "  -- t", "end", "-- x -> a"), "E217");
  });

  it("E220: a jump inside a branch must be the last transition of a select leg", () => {
    // jump in a parallel leg
    one(src("init a", "-- go", "parallel", "  step b", "  -- t -> b", "  step c", "|", "  step d", "end", "-- x -> a"), "E220");
    // jump in the middle of a select leg
    one(src("init a", "select", "  -- x -> a", "  step b", "  -- y", "|", "  -- z", "end", "step c", "-- q -> a"), "E220");
  });

  it("E221: a nested select must keep one leg going", () => {
    one(src(
      "init a", "-- go",
      "parallel",
      "  step b",
      "  select", "    -- x -> b", "  |", "    -- y -> b", "  end",
      "  step c",
      "|",
      "  step d",
      "end",
      "-- q -> a",
    ), "E221");
  });

  it("a top-level select whose legs all jump stops the flow (new chain after it)", () => {
    expect(codes(src("init a", "select", "  -- x -> b", "|", "  -- y -> a", "end", "step b", "-- z -> a"))).toEqual([]);
  });

  it("loops inside a parallel leg via a nested select are valid", () => {
    expect(codes(src(
      "init a", "-- go",
      "parallel",
      "  step fill_a",
      "  select", "    -- retry -> fill_a", "  |", "    -- level_ok", "  end",
      "  step done_a",
      "|",
      "  step b",
      "end",
      "-- all -> a",
    ))).toEqual([]);
  });

  it("jumps into a select leg are valid", () => {
    expect(codes(src(
      "init a",
      "select", "  -- x", "  step b", "  -- y", "|", "  -- z", "end",
      "step c",
      "-- back -> b",
    ))).toEqual([]);
  });
});

describe("validate: chains and ends (SPEC §6.3, §6.5)", () => {
  it("E306: unreachable chain head", () => {
    const d = one(src("init a", "-- x -> a", "step lost", "-- y -> a"), "E306");
    expect(d.message).toBe("step `lost` can never become active (no jump or flow reaches it)");
  });

  it("E306: reachable only from an unreachable chain", () => {
    expect(check(src("init a", "-- x -> a", "step b", "-- y -> c", "step c", "-- z -> b")).filter((d) => d.code === "E306").map((d) => d.span.line)).toEqual([3, 5]);
  });

  it("the §6.3 chains example is valid", () => {
    expect(codes(fixture("chains.qsfc"))).toEqual([]);
  });

  it("E308: transition leading nowhere", () => {
    const d = one(src("init a", "-- x"), "E308");
    expect(d.message).toBe("transition `T1` leads nowhere: add `-> step` or a step after it");
  });

  it("W300: chain ends on a step", () => {
    const d = one(src("init a", "-- x", "step done"), "W300");
    expect(d.severity).toBe("warning");
    expect(d.message).toBe("step `done` has no transition after it: the chart stops there");
  });
});

describe("validate: initial step (E300-E302)", () => {
  it("E300: no initial step", () => {
    expect(one(src("step a", "-- x -> a"), "E300").span.line).toBe(1);
  });

  it("E301: two initial steps", () => {
    const d = one(src("init idle", "-- x", "init start", "-- y -> idle"), "E301");
    expect(d.message).toBe("more than one initial step: `idle` (line 1) and `start` (line 3)");
  });

  it("E302: initial step inside a parallel", () => {
    expect(codes(src("step a", "-- go", "parallel", "  init b", "|", "  step c", "end", "-- x -> a"))).toContain("E302");
  });

  it("the initial step may be inside a select leg", () => {
    expect(codes(src("step a", "select", "  -- x", "  init b", "  -- y", "|", "  -- z", "end", "step c", "-- q -> a"))).toEqual([]);
  });
});

describe("validate: names and conditions", () => {
  it("E307: empty condition", () => {
    expect(one(src("init a", "-- -> a"), "E307").message).toBe('transition has no condition; write `TRUE` for "always"');
  });

  it("E309: duplicate names, case-insensitive, steps and transitions", () => {
    const d = one(src("init fill", "-- x", "step Fill", "-- y -> fill"), "E309");
    expect(d.message).toBe("name `Fill` is already used by the step at line 1");
    expect(d.span).toMatchObject({ line: 3, col: 6 });
    expect(one(src("init a", "-- a: x -> a"), "E309").message).toContain("step at line 1");
  });
});

describe("validate: jumps (SPEC §6.2)", () => {
  it("E303: unknown target, with a suggestion", () => {
    const d = one(src("init idle", "-- x -> idel"), "E303");
    expect(d.message).toBe("jump target `idel` doesn't exist; did you mean `idle`?");
    expect(d.span).toMatchObject({ line: 2, col: 9 });
    expect(one(src("init idle", "-- x -> zzzzzz"), "E303").message).toBe("jump target `zzzzzz` doesn't exist");
  });

  it("E304: target is a transition", () => {
    expect(one(src("init a", "-- good: x -> good"), "E304").message).toBe("jump target `good` is a transition; jumps go to steps");
  });

  it("E305: a jump can't enter a parallel", () => {
    one(src("init a", "-- go", "parallel", "  step b", "|", "  step c", "end", "-- x", "step d", "-- y -> b"), "E305");
  });

  it("E305: a jump can't leave a parallel", () => {
    one(src(
      "init a", "-- go",
      "parallel",
      "  step b",
      "  select", "    -- out -> a", "  |", "    -- ok", "  end",
      "  step c",
      "|",
      "  step d",
      "end",
      "-- x -> a",
    ), "E305");
  });

  it("E305: a jump can't cross between legs of one parallel", () => {
    one(src(
      "init a", "-- go",
      "parallel",
      "  step b",
      "  select", "    -- across -> d", "  |", "    -- ok", "  end",
      "  step c",
      "|",
      "  step d",
      "end",
      "-- x -> a",
    ), "E305");
  });

  it("W301: jump to the next step", () => {
    const d = one(src("init a", "-- x -> b", "step b", "-- y -> a"), "W301");
    expect(d.severity).toBe("warning");
    expect(d.message).toBe("jump to `b` is not needed: it is the next step anyway");
  });

  it("W301: last select leg jumping to the step after end, when nothing else merges", () => {
    one(src("init a", "select", "  -- x -> a", "|", "  -- y -> b", "end", "step b", "-- z -> a"), "W301");
  });

  it("no W301 when the next step has other incoming paths", () => {
    expect(codes(src("init a", "-- x -> b", "step b", "-- y -> b"))).toEqual([]);
    expect(codes(src("init a", "select", "  -- x", "|", "  -- y -> b", "end", "step b", "-- z -> a"))).toEqual([]);
  });
});

describe("validate: invariants used by lowering", () => {
  // Each shape breaks one invariant; the validator must always report an error.
  const broken: Record<string, string> = {
    "select after a transition": src("init a", "-- x", "select", "  -- y -> a", "|", "  -- z -> a", "end"),
    "select after a parallel end": src("init a", "-- g", "parallel", "  step b", "|", "  step c", "end", "select", "  -- y -> a", "|", "  -- z -> a", "end"),
    "select leg starting with a select": src("init a", "select", "  select", "    -- p -> a", "  |", "    -- q -> a", "  end", "|", "  -- z -> a", "end"),
    "select leg starting with a parallel": src("init a", "select", "  parallel", "    step p", "  |", "    step q", "  end", "  -- r -> a", "|", "  -- z -> a", "end"),
    "parallel after a select end": src("init a", "select", "  -- x", "|", "  -- y", "end", "parallel", "  step b", "|", "  step c", "end", "-- z -> a"),
    "parallel leg starting with a parallel": src("init a", "-- g", "parallel", "  parallel", "    step p", "  |", "    step q", "  end", "  -- t", "  step r", "|", "  step c", "end", "-- z -> a"),
    "parallel leg starting with a select": src("init a", "-- g", "parallel", "  select", "    -- p", "  |", "    -- q", "  end", "  step r", "|", "  step c", "end", "-- z -> a"),
    "select leg ending with a select": src("init a", "select", "  -- x", "  step s", "  select", "    -- p", "  |", "    -- q", "  end", "|", "  -- z", "end", "step e", "-- w -> a"),
    "parallel leg ending with a parallel": src("init a", "-- g", "parallel", "  step s", "  -- t", "  parallel", "    step p", "  |", "    step q", "  end", "|", "  step c", "end", "-- z -> a"),
    "transition after a select end": src("init a", "select", "  -- x", "|", "  -- y", "end", "-- z -> a"),
    "step after a parallel end": src("init a", "-- g", "parallel", "  step b", "|", "  step c", "end", "step d", "-- z -> a"),
  };
  it.each(Object.entries(broken))("%s is an error", (_name, s) => {
    const { chart } = parse(s);
    expect(validate(chart).some((d) => d.severity === "error")).toBe(true);
  });
});
