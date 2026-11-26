import { describe, expect, it } from "vitest";
import { jumpArrow, lineKind, tokenBefore, tokenizeLine, TOKEN_STYLE, type TokKind } from "../../app/highlight.js";

/** [text, kind] pairs of a line, for readable expectations. */
function toks(line: string): Array<[string, TokKind]> {
  return tokenizeLine(line).map((t) => [line.slice(t.from, t.to), t.kind]);
}

describe("lineKind", () => {
  it("classifies by the first word, case-insensitively, ignoring indentation", () => {
    expect(lineKind("").kind).toBe("blank");
    expect(lineKind("   ").kind).toBe("blank");
    expect(lineKind("  // x").kind).toBe("comment");
    expect(lineKind("sfc tank").kind).toBe("header");
    expect(lineKind("TAG x : DINT").kind).toBe("tag");
    expect(lineKind("  Init idle").kind).toBe("step");
    expect(lineKind("step fill").kind).toBe("step");
    expect(lineKind("select").kind).toBe("branch");
    expect(lineKind("parallel").kind).toBe("branch");
    expect(lineKind("end").kind).toBe("end");
    expect(lineKind("  -- go").kind).toBe("transition");
    expect(lineKind("|").kind).toBe("bar");
    expect(lineKind("  motor := 1;").kind).toBe("action");
    expect(lineKind("stepper := 1;").kind).toBe("action");
    expect(lineKind("  step x").start).toBe(2);
  });
});

describe("tokenizeLine", () => {
  it("step lines: keyword, name, duration, description, comment", () => {
    expect(toks('step fill 1m30s "Fill the tank" // note')).toEqual([
      ["step", "kw"],
      ["fill", "def"],
      ["1m30s", "duration"],
      ['"Fill the tank"', "string"],
      ["// note", "comment"],
    ]);
    expect(toks("  INIT idle")).toEqual([
      ["INIT", "kw"],
      ["idle", "def"],
    ]);
  });

  it("a `//` inside a step description is not a comment", () => {
    expect(toks('step a "x // y"')).toEqual([
      ["step", "kw"],
      ["a", "def"],
      ['"x // y"', "string"],
    ]);
  });

  it("an unclosed description runs to the end of the line", () => {
    expect(toks('step a "open')).toEqual([
      ["step", "kw"],
      ["a", "def"],
      ['"open', "string"],
    ]);
  });

  it("a number without a unit is a number, not a duration", () => {
    expect(toks("step a 5")).toEqual([
      ["step", "kw"],
      ["a", "def"],
      ["5", "number"],
    ]);
  });

  it("tag lines: name, type, description", () => {
    expect(toks('tag count : DINT "Parts"')).toEqual([
      ["tag", "kw"],
      ["count", "def"],
      [":", "punct"],
      ["DINT", "type"],
      ['"Parts"', "string"],
    ]);
  });

  it("header, branch keywords and leg separator", () => {
    expect(toks("sfc tank")).toEqual([
      ["sfc", "kw"],
      ["tank", "def"],
    ]);
    expect(toks("  select // choose")).toEqual([
      ["select", "kw"],
      ["// choose", "comment"],
    ]);
    expect(toks("|")).toEqual([["|", "kw"]]);
    expect(toks("END")).toEqual([["END", "kw"]]);
  });

  it("transitions: name, ST condition, jump and comment", () => {
    expect(toks("-- done: count >= 10 AND fill.DN -> idle // back")).toEqual([
      ["--", "kw"],
      ["done", "label"],
      [":", "punct"],
      ["count", "ident"],
      [">=", "op"],
      ["10", "number"],
      ["AND", "stkw"],
      ["fill", "ident"],
      [".", "punct"],
      ["DN", "member"],
      ["->", "arrow"],
      ["idle", "target"],
      ["// back", "comment"],
    ]);
  });

  it("`x := ...` after `--` is not a transition name", () => {
    expect(toks("-- a := 1").map(([, k]) => k)).toEqual(["kw", "ident", "op", "number"]);
  });

  it("`->` inside an ST string is not a jump", () => {
    expect(toks("-- s = '->x'").map(([t, k]) => `${t}:${k}`)).toEqual(["--:kw", "s:ident", "=:op", "'->x':stkw".replace("stkw", "string")]);
  });

  it("action lines are ST: keywords, assignments, functions, strings, comments", () => {
    expect(toks("  IF level > 80.5 THEN valve [:=] ABS(x); END_IF; // c")).toEqual([
      ["IF", "stkw"],
      ["level", "ident"],
      [">", "op"],
      ["80.5", "number"],
      ["THEN", "stkw"],
      ["valve", "ident"],
      ["[:=]", "op"],
      ["ABS", "func"],
      ["(", "punct"],
      ["x", "ident"],
      [")", "punct"],
      [";", "punct"],
      ["END_IF", "stkw"],
      [";", "punct"],
      ["// c", "comment"],
    ]);
    expect(toks("msg := 'it''s';").map(([, k]) => k)).toEqual(["ident", "op", "string", "string", "punct"]);
    expect(toks("x := 16#FF;").map(([t, k]) => `${t}:${k}`)).toEqual(["x:ident", ":=:op", "16#FF:number", ";:punct"]);
  });

  it("comment lines and blank lines", () => {
    expect(toks("  // all comment")).toEqual([["// all comment", "comment"]]);
    expect(toks("   ")).toEqual([]);
  });

  it("tokens never overlap and stay inside the line", () => {
    const lines = [
      'step a 5s "d"',
      "-- n: a.X AND (b OR c) -> z",
      "x [:=] y + 2 * z; (* c *) w := 1;",
      "tag t : TIMER",
      '-- "unclosed',
      "-- ->",
      "--",
    ];
    for (const l of lines) {
      let end = 0;
      for (const t of tokenizeLine(l)) {
        expect(t.from).toBeGreaterThanOrEqual(end);
        expect(t.to).toBeGreaterThan(t.from);
        expect(t.to).toBeLessThanOrEqual(l.length);
        end = t.to;
      }
    }
  });

  it("every token kind maps to a highlight tag", () => {
    for (const v of Object.values(TOKEN_STYLE)) expect(v).toMatch(/^[a-zA-Z.]+$/);
  });
});

describe("jumpArrow / tokenBefore", () => {
  it("finds the jump outside strings and before comments", () => {
    expect(jumpArrow("-- a -> b", 2)).toBe(5);
    expect(jumpArrow("-- 'x->' ", 2)).toBe(-1);
    expect(jumpArrow("-- a // -> b", 2)).toBe(-1);
  });
  it("tokenBefore returns the token the cursor is in or at the end of", () => {
    const line = "step fill";
    const t = tokenizeLine(line);
    expect(tokenBefore(t, 9)?.kind).toBe("def");
    expect(tokenBefore(t, 4)?.kind).toBe("kw");
    expect(tokenBefore(t, 0)).toBeUndefined();
  });
});

describe("indentAfter", () => {
  it("indents actions under steps and legs inside branches", async () => {
    const { indentAfter } = await import("../../app/highlight.js");
    expect(indentAfter(undefined)).toBe(0);
    expect(indentAfter("init idle")).toBe(2);
    expect(indentAfter("  motor := 0;")).toBe(2);
    expect(indentAfter("-- go")).toBe(0);
    expect(indentAfter("  step pack")).toBe(4);
    expect(indentAfter("select")).toBe(2);
    expect(indentAfter("|")).toBe(2);
    expect(indentAfter("end")).toBe(0);
    expect(indentAfter("  tag x : DINT")).toBe(0);
    expect(indentAfter("step a", 4)).toBe(4);
  });
});

describe("indentStructure", () => {
  it("lines structure lines up with their step / branch", async () => {
    const { indentStructure } = await import("../../app/highlight.js");
    // nearest line first
    expect(indentStructure("-- go", ["    motor := 1;", "  step a"])).toBe(2);
    expect(indentStructure("-- go", ["  step a"])).toBe(2);
    expect(indentStructure("step b", ["  -- go"])).toBe(2);
    expect(indentStructure("end", ["    -- x", "    step p", "  |", "    -- y", "  select"])).toBe(2);
    expect(indentStructure("|", ["  end", "  -- z", "  select", "select"])).toBe(0);
    expect(indentStructure("|", [])).toBe(0);
    expect(indentStructure("motor := 1;", ["step a"])).toBeUndefined();
    expect(indentStructure("-- a", [])).toBe(0);
  });
});

describe("routines and calls (SPEC §4.5)", () => {
  it("`program`, `sfc` and `st` headers are keywords with a defined name", () => {
    expect(toks("program tank")).toEqual([
      ["program", "kw"],
      ["tank", "def"],
    ]);
    expect(toks("st main // main routine")).toEqual([
      ["st", "kw"],
      ["main", "def"],
      ["// main routine", "comment"],
    ]);
    expect(lineKind("ST alarms").kind).toBe("header");
    expect(lineKind("program").kind).toBe("header");
  });

  it("`st := 1;` and `program = 2` stay ST (same rule as the parser)", () => {
    expect(lineKind("st := 1;").kind).toBe("action");
    expect(lineKind("program = 2;").kind).toBe("action");
    expect(toks("st := 1;")[0]).toEqual(["st", "ident"]);
  });

  it("`call` before a routine name is a keyword, in actions and ST", () => {
    expect(toks("  call fill_seq;")).toEqual([
      ["call", "kw"],
      ["fill_seq", "ident"],
      [";", "punct"],
    ]);
    expect(toks("IF go THEN CALL alarms; END_IF;").map(([t, k]) => `${t}:${k}`)).toContain("CALL:kw");
    // `call` alone, or a member named call, is not the statement
    expect(toks("call := 1;")[0]).toEqual(["call", "ident"]);
    expect(toks("x.call := 1;")[2]).toEqual(["call", "member"]);
  });

  it("headerOf gives the keyword and the name", async () => {
    const { headerOf } = await import("../../app/highlight.js");
    expect(headerOf("  sfc fill_seq")).toEqual({ keyword: "sfc", name: "fill_seq" });
    expect(headerOf("PROGRAM tank")).toEqual({ keyword: "program", name: "tank" });
    expect(headerOf("st := 1;")).toBeUndefined();
    expect(headerOf("step fill")).toBeUndefined();
  });

  it("a new line after `st name` is indented like an action", async () => {
    const { indentAfter } = await import("../../app/highlight.js");
    expect(indentAfter("st alarms")).toBe(2);
    expect(indentAfter("sfc fill")).toBe(0);
    expect(indentAfter("program tank")).toBe(0);
  });
});
