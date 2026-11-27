/** `after <duration>` needs the single step before its transition (SPEC §4.4, E416), and lowering finds it. */
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { lower } from "../../src/lower/index.js";
import { parse } from "../../src/parse/index.js";
import { validate } from "../../src/validate/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const e416 = (s: string) => validate(parse(s).chart).filter((d) => d.code === "E416");
const afterSteps = (s: string): Array<[string, string | undefined]> =>
  lower(parse(s).chart).transitions.map((t) => [t.condition, t.afterStep]);

describe("validate: E416", () => {
  it("after the end of a parallel block", () => {
    const s = src("init a", "-- go", "parallel", "  step b", "|", "  step c", "end", "-- after 5s AND x -> a");
    const d = e416(s);
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`after` needs one step before the transition; this transition follows the `end` of a `parallel` block");
    expect(d[0]!.span).toEqual({ line: 8, col: 4, endLine: 8, endCol: 12 });
    expect(compile(s).diagnostics.map((d) => d.code)).toEqual(["E416"]);
  });

  it("no E416 after a step, at the start of a select leg, or in a parallel leg", () => {
    const s = src(
      "init a",
      "-- after 1s",
      "step b",
      "select",
      "  -- after 2s",
      "  step c",
      "  -- after 3s -> a",
      "|",
      "  -- NOT after 2s",
      "end",
      "step d",
      "-- go",
      "parallel",
      "  step e",
      "  -- after 4s",
      "  step f",
      "|",
      "  step g",
      "end",
      "-- TRUE -> a",
    );
    expect(compile(s).diagnostics).toEqual([]);
  });
});

describe("lower: the step of an after term", () => {
  it("is the step before the transition, or the step before the select for a leg's first transition", () => {
    const s = src(
      "init a",
      "-- after 1s",
      "step b",
      "select",
      "  -- after 2s",
      "  step c",
      "  select",
      "    -- after 3s -> a",
      "  |",
      "    -- x",
      "  end",
      "  step c2",
      "  -- after 4s -> a",
      "|",
      "  -- y -> a",
      "end",
    );
    expect(afterSteps(s)).toEqual([
      ["after 1s", "a"],
      ["after 2s", "b"],
      ["after 3s", "c"],
      ["x", undefined],
      ["after 4s", "c2"],
      ["y", undefined],
    ]);
  });
});
