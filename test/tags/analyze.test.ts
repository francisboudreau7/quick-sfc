import { describe, expect, it } from "vitest";
import { act, byCode, codes, colOf, cond, run, tagType } from "./helpers.js";

describe("tag creation and spans", () => {
  it("creates a tag per identifier with exact spans in actions and conditions", () => {
    const r = run({
      body: [
        { step: "fill", init: true, presetMs: 5000, action: ["valve [:=] 1;", "  pump := valve;"] },
        { tran: "start_btn AND fill.DN", name: "go" },
      ],
    });
    expect(r.tags.map((t) => t.name)).toEqual(["pump", "start_btn", "valve"]);
    const valve = r.tags.find((t) => t.name === "valve")!;
    // line 2 = "  valve [:=] 1;" (text col 3), line 3 = "    pump := valve;"
    expect(valve.uses).toEqual([
      { line: 2, col: 3, endLine: 2, endCol: 8 },
      { line: 3, col: colOf(r.lines, 3, "valve"), endLine: 3, endCol: colOf(r.lines, 3, "valve") + 5 },
    ]);
    const sb = r.tags.find((t) => t.name === "start_btn")!;
    expect(sb.uses).toEqual([{ line: 4, col: colOf(r.lines, 4, "start_btn"), endLine: 4, endCol: colOf(r.lines, 4, "start_btn") + 9 }]);
  });

  it("sorts tags case-insensitively and is deterministic", () => {
    const r = cond("Zeta AND alpha AND Beta");
    expect(r.tags.map((t) => t.name)).toEqual(["alpha", "Beta", "Zeta"]);
    expect(JSON.stringify(cond("Zeta AND alpha AND Beta"))).toBe(JSON.stringify(r));
  });

  it("skips ST keywords, TRUE/FALSE, numbers and function names", () => {
    const r = act([
      "IF a AND NOT b OR TRUE THEN",
      "  c := ABS(d) + 16#FF_FF + 2#1010 + 8#17;",
      "  e := 2.0E3 * 1.5;",
      "ELSIF x XOR FALSE THEN",
      "  TON (tmr, 5);",
      "END_IF;",
    ]);
    expect(r.tags.map((t) => t.name)).toEqual(["a", "b", "c", "d", "e", "tmr", "x"]);
  });

  it("scans function arguments as normal expressions and skips formal parameter names", () => {
    const r = act(["TON(IN := go, PT := 5, ET => elapsed);"]);
    expect(r.tags.map((t) => t.name)).toEqual(["elapsed", "go"]);
  });

  it("ignores identifiers in strings and comments", () => {
    const r = act([
      "msg := 'not_a_tag and \"x\"';  // trailing_comment",
      "(* block_comment",
      "   still_comment *)",
      "other := \"dq_string\"; (* inline *) real_one := 1;",
    ]);
    expect(r.tags.map((t) => t.name)).toEqual(["msg", "other", "real_one"]);
  });

  it("block comments span several action lines and positions stay exact", () => {
    const r = act(["(* start", "ghost := 1;", "end *) visible := 1;"]);
    expect(r.tags.map((t) => t.name)).toEqual(["visible"]);
    const u = r.tags[0]!.uses[0]!;
    expect(u.line).toBe(4);
    expect(u.col).toBe(colOf(r.lines, 4, "visible"));
  });

  it("handles ST string escapes with $", () => {
    const r = act(["s := 'it$'s a_string'; t := 1;"]);
    expect(r.tags.map((t) => t.name)).toEqual(["s", "t"]);
    expect(byCode(r, "E407")).toHaveLength(0);
  });

  it("member access chains and bit access use the base tag only", () => {
    const r = act(["x.0 := 1;", "n := x;"]);
    expect(r.tags.map((t) => t.name)).toEqual(["n", "x"]);
  });
});

describe("inference table (SPEC 7.2), row by row", () => {
  it("alone as a Boolean operand -> BOOL", () => {
    const r = cond("start_btn", "NOT x", "a AND b", "c OR d XOR e");
    for (const n of ["start_btn", "x", "a", "b", "c", "d", "e"]) expect(tagType(r, n)).toBe("BOOL");
  });
  it("assigned only 0/1/TRUE/FALSE -> BOOL", () => {
    const r = act(["a := 0;", "b := 1;", "c := TRUE;", "d [:=] FALSE;", "e [:=] 1;"]);
    for (const n of ["a", "b", "c", "d", "e"]) expect(tagType(r, n)).toBe("BOOL");
  });
  it("assigned another integer -> DINT", () => {
    expect(tagType(act(["n := 5;"]), "n")).toBe("DINT");
    expect(tagType(act(["n := 0;", "n := 7;"]), "n")).toBe("DINT");
    expect(tagType(act(["n := -1;"]), "n")).toBe("DINT");
    expect(tagType(act(["n := 16#FF;"]), "n")).toBe("DINT");
    expect(tagType(act(["n := 16#1;"]), "n")).toBe("BOOL");
  });
  it("used in + - * / MOD -> DINT", () => {
    const r = act(["r := a + b - c * d / e MOD f;"]);
    for (const n of ["r", "a", "b", "c", "d", "e", "f"]) expect(tagType(r, n)).toBe("DINT");
  });
  it("compared with < > <= >= -> DINT", () => {
    const r = cond("a < 5", "b > c", "d <= 1", "e >= 0");
    for (const n of ["a", "b", "c", "d", "e"]) expect(tagType(r, n)).toBe("DINT");
  });
  it("compared with = or <> to an integer other than 0/1 -> DINT", () => {
    const r = cond("a = 5", "b <> 7", "c = 0", "d <> 1", "e = TRUE");
    expect(tagType(r, "a")).toBe("DINT");
    expect(tagType(r, "b")).toBe("DINT");
    expect(tagType(r, "c")).toBe("BOOL");
    expect(tagType(r, "d")).toBe("BOOL");
    expect(tagType(r, "e")).toBe("BOOL");
  });
  it("any use together with a decimal number -> REAL", () => {
    const r = act(["a := 1.5;", "b := c * 2.0E3;", "d := (e + f) * 1.5;", "IF g > 2.5 THEN h := 1; END_IF;"]);
    for (const n of ["a", "b", "c", "d", "e", "f", "g"]) expect(tagType(r, n)).toBe("REAL");
    expect(tagType(r, "h")).toBe("BOOL");
    expect(tagType(cond("lvl = 1.5"), "lvl")).toBe("REAL");
  });
  it("a := b gives both the same type", () => {
    const r = act(["a := b;", "b := 1.5;"]);
    expect(tagType(r, "a")).toBe("REAL");
    expect(tagType(r, "b")).toBe("REAL");
  });
  it("no clue -> BOOL", () => {
    const r = act(["x := y;"]);
    expect(tagType(r, "x")).toBe("BOOL");
    expect(tagType(r, "y")).toBe("BOOL");
    expect(tagType(act(["f(z);"]), "z")).toBe("BOOL");
  });
  it("bit access -> DINT", () => {
    const r = act(["x.0 := 1;", "IF y.3 THEN z := 1; END_IF;"]);
    expect(tagType(r, "x")).toBe("DINT");
    expect(tagType(r, "y")).toBe("DINT");
  });
  it("tag = tag unifies", () => {
    const r = run({ body: [{ step: "s0", init: true, action: ["a := 5;"] }, { tran: "a = b" }] });
    expect(tagType(r, "b")).toBe("DINT");
  });
  it("CASE / FOR / array-index contexts are DINT", () => {
    const r = act(["CASE sel OF", "1: out := 2;", "END_CASE;", "FOR i := 0 TO limit DO", "  total := total + 1;", "END_FOR;"]);
    expect(tagType(r, "sel")).toBe("DINT");
    expect(tagType(r, "i")).toBe("DINT");
    expect(tagType(r, "limit")).toBe("DINT");
    expect(tagType(r, "out")).toBe("DINT");
    expect(tagType(r, "total")).toBe("DINT");
  });
});

describe("fixed point propagation", () => {
  it("propagates through a chain of assignments, whatever the order", () => {
    const r = act(["a := b;", "b := c;", "c := d;", "d := 2.5;"]);
    for (const n of ["a", "b", "c", "d"]) expect(tagType(r, n)).toBe("REAL");
  });
  it("propagates DINT backwards and forwards", () => {
    const r = act(["x := y;", "z := x + 1;", "w := y;"]);
    for (const n of ["x", "y", "z", "w"]) expect(tagType(r, n)).toBe("DINT");
  });
  it("conflicts are found through the chain", () => {
    const r = act(["a := b;", "IF a THEN q := 1; END_IF;", "b := 1.5;"]);
    expect(byCode(r, "E404")).toHaveLength(1);
  });
  it("declared types propagate through assignments", () => {
    const r = act(["a := count;"], { tagDecls: [{ name: "count", type: "DINT" }] });
    expect(tagType(r, "a")).toBe("DINT");
    expect(byCode(r, "E404")).toHaveLength(0);
  });
});

describe("E400 / E401 / W302 step references", () => {
  const body = [
    { step: "fill", init: true, presetMs: 5000 },
    { step: "wait" },
  ];
  it("E400: a step used alone, with a hint", () => {
    const r = run({ body: [...body, { tran: "fill AND x" }] });
    const d = byCode(r, "E400");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("`fill` is a step; use `fill.X`");
    expect(d[0]!.span.line).toBe(3);
    expect(d[0]!.span.col).toBe(colOf(r.lines, 3, "fill"));
    expect(r.tags.map((t) => t.name)).toEqual(["x"]);
  });
  it("E401: unknown member, with did-you-mean", () => {
    const r = run({ body: [...body, { tran: "fill.DONE" }, { tran: "fill.Dn OR fill.zzzzzz" }] });
    const d = byCode(r, "E401");
    expect(d).toHaveLength(2);
    expect(d[0]!.message).toBe("`fill.DONE`: steps have no member `DONE` (did you mean `DN`?)");
    expect(d[1]!.message).not.toContain("did you mean");
    expect(d[1]!.hint).toContain("valid members");
  });
  it("members are case-insensitive and all valid ones are accepted", () => {
    const members = ["X", "FS", "SA", "LS", "DN", "OV", "T", "PRE", "TMax", "Count", "Reset", "PauseTimer", "AlarmEn", "AlarmLow", "AlarmHigh", "LimitLow", "LimitHigh", "Status"];
    const r = run({ body: [...body, ...members.map((m) => ({ tran: `FILL.${m.toLowerCase()}` }))] });
    expect(codes(r)).toEqual([]);
    expect(r.tags).toEqual([]);
  });
  it("step names are case-insensitive", () => {
    const r = run({ body: [...body, { tran: "FiLL.X" }] });
    expect(r.tags).toEqual([]);
  });
  it("W302: .DN on a step without a preset", () => {
    const r = run({ body: [...body, { tran: "wait.DN" }, { tran: "fill.DN" }] });
    const d = byCode(r, "W302");
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("warning");
    expect(d[0]!.message).toBe("`wait.DN` is used but `wait` has no preset, so it is TRUE immediately");
    expect(d[0]!.span.line).toBe(3);
  });
  it("step references never create tags and do not count as tag uses", () => {
    const r = act(["x := fill.T + 1;"], { body: [{ step: "fill", presetMs: 1 }] });
    expect(r.tags.map((t) => t.name)).toEqual(["x"]);
  });
  it("a step name followed by ( is a function, not a step reference", () => {
    const r = act(["fill(a);"], { body: [{ step: "fill" }] });
    expect(codes(r)).not.toContain("E400");
  });
});

describe("E402 / E403 member and array access", () => {
  it("E402: member access on a non-step tag", () => {
    const r = cond("tmr.DN");
    const d = byCode(r, "E402");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("type of `tmr` unknown (it has member `.DN`): add `tag tmr : TIMER`");
    expect(d[0]!.span.col).toBe(colOf(r.lines, 2, "tmr"));
    expect(r.tags.map((t) => t.name)).toEqual(["tmr"]);
  });
  it("no E402 when a declaration gives the type", () => {
    const r = run({
      tagDecls: [{ name: "tmr", type: "TIMER" }],
      body: [{ step: "s0", init: true }, { tran: "tmr.DN AND tmr.EN" }],
    });
    expect(codes(r)).not.toContain("E402");
    expect(r.tags[0]).toMatchObject({ name: "tmr", type: "TIMER", declared: true });
  });
  it("E402 still applies when the declaration has no type", () => {
    const r = run({ tagDecls: [{ name: "tmr", description: "a timer" }], body: [{ step: "s0", init: true }, { tran: "tmr.DN" }] });
    expect(codes(r)).toContain("E402");
  });
  it("E403: array access, index is scanned", () => {
    const r = act(["a[idx] := 1;"]);
    const d = byCode(r, "E403");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`a[idx]` needs a declared array tag (not supported yet)");
    expect(r.tags.map((t) => t.name)).toEqual(["a", "idx"]);
    expect(tagType(r, "idx")).toBe("DINT");
  });
  it("E403 even when the array tag is declared (Phase 1)", () => {
    const r = act(["a[3] := 1;"], { tagDecls: [{ name: "a", type: "DINT" }] });
    expect(codes(r)).toContain("E403");
  });
});

describe("E404 type conflicts", () => {
  it("names both lines", () => {
    const r = run({
      body: [
        { step: "s0", init: true, action: ["IF level THEN", "  q := 1;", "END_IF;", "level := 1.5;"] },
      ],
    });
    const d = byCode(r, "E404");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`level` is used as BOOL (line 2) and as REAL (line 5): add `tag level : REAL`");
    expect(d[0]!.span.line).toBe(5);
    expect(d[0]!.severity).toBe("error");
  });
  it("BOOL vs DINT", () => {
    const r = cond("n AND m", "n > 3");
    expect(byCode(r, "E404")).toHaveLength(1);
  });
  it("DINT and REAL do not conflict (REAL wins)", () => {
    const r = act(["x := y + 1;", "x := 1.5;", "IF x > 3 THEN q := 1; END_IF;"]);
    expect(byCode(r, "E404")).toHaveLength(0);
    expect(tagType(r, "x")).toBe("REAL");
  });
  it("a 0/1 assignment is weak: it never conflicts with a numeric use", () => {
    const r = act(["count := 0;", "count := count + 1;"]);
    expect(byCode(r, "E404")).toHaveLength(0);
    expect(tagType(r, "count")).toBe("DINT");
  });
  it("declared type wins; a contradicting use is an error that mentions the declaration", () => {
    const r = act(["count := 1.5;"], { tagDecls: [{ name: "count", type: "DINT" }] });
    const d = byCode(r, "E404");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`count` is used as REAL (line 3) but declared as DINT (line 1)");
    expect(tagType(r, "count")).toBe("DINT");
  });
  it("declared REAL accepts integer use; declared BOOL rejects arithmetic", () => {
    expect(codes(act(["x := x + 1;"], { tagDecls: [{ name: "x", type: "REAL" }] }))).not.toContain("E404");
    expect(codes(act(["x := x + 1;"], { tagDecls: [{ name: "x", type: "BOOL" }] }))).toContain("E404");
  });
  it("declared type applies even with no use evidence", () => {
    const r = act(["lvl := 0;"], { tagDecls: [{ name: "lvl", type: "REAL" }] });
    expect(tagType(r, "lvl")).toBe("REAL");
    expect(codes(r)).not.toContain("E404");
  });
});

describe("E405 / E410 reserved names and namespace", () => {
  it("E405 for generated operand names, in uses and declarations", () => {
    const r = act(["Step_003 := 1;", "action_12 := 1;"], { tagDecls: [{ name: "Tran_001", type: "BOOL" }] });
    const d = byCode(r, "E405");
    expect(d.map((x) => x.message)).toEqual([
      "`Tran_001` is a reserved name (used for generated operands)",
      "`Step_003` is a reserved name (used for generated operands)",
      "`action_12` is a reserved name (used for generated operands)",
    ]);
  });
  it("E405 for qSFC keywords used as identifiers; Step_x is fine", () => {
    const r = act(["select := 1;", "Step_x := 1;", "Stepper := 1;"]);
    const d = byCode(r, "E405");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("`select`");
  });
  it("E410 for a declared tag with a step's name", () => {
    const r = run({ tagDecls: [{ name: "pack", type: "BOOL" }], body: [{ step: "pack", init: true }] });
    const d = byCode(r, "E410");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`pack` is both a step and a tag");
    expect(d[0]!.span).toEqual({ line: 1, col: 5 });
    expect(codes(r)).not.toContain("W404");
  });
  it("E410 for a use of a transition's name", () => {
    const r = run({ body: [{ step: "s0", init: true, action: ["go := 1;"] }, { tran: "x", name: "go" }] });
    const d = byCode(r, "E410");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`go` is both a transition and a tag");
  });
});

describe("ST slips: E406 / E407 / W402 / W403", () => {
  it("E406: := in a condition (also [:=])", () => {
    const r = cond("a := 1", "b [:=] 1");
    const d = byCode(r, "E406");
    expect(d).toHaveLength(2);
    expect(d[0]!.message).toBe("`:=` in a condition: did you mean `=`?");
    expect(d[0]!.span.col).toBe(colOf(r.lines, 2, ":="));
    expect(d[1]!.span.col).toBe(colOf(r.lines, 3, "[:=]"));
  });
  it("E406 does not fire for named call arguments", () => {
    expect(codes(cond("f(IN := a)"))).not.toContain("E406");
  });
  it("E407: unbalanced parenthesis in a condition", () => {
    const r = cond("(a AND b");
    const d = byCode(r, "E407");
    expect(d).toHaveLength(1);
    expect(d[0]!.span.col).toBe(colOf(r.lines, 2, "("));
    expect(byCode(cond("a AND b)"), "E407")).toHaveLength(1);
    expect(byCode(cond("a[1 AND b"), "E407")).toHaveLength(1);
    expect(byCode(cond("(a AND b]"), "E407")).toHaveLength(1);
    expect(byCode(cond("(a) AND [b]"), "E407")).toHaveLength(0);
  });
  it("E407: bracket balance is per whole action (multi-line)", () => {
    expect(byCode(act(["x := f(a,", "  b);"]), "E407")).toHaveLength(0);
    expect(byCode(act(["x := f(a,", "  b;"]), "E407")).toHaveLength(1);
  });
  it("E407: unterminated string, once per unit, at the quote", () => {
    const r = act(["msg := 'oops;", "y := (1;"]);
    const d = byCode(r, "E407");
    expect(d).toHaveLength(1);
    expect(d[0]!.span).toMatchObject({ line: 2, col: colOf(r.lines, 2, "'") });
    expect(byCode(cond("a = 'x"), "E407")).toHaveLength(1);
  });
  it("brackets inside strings and comments do not count", () => {
    expect(byCode(act(["x := ')' ; // (", "(* ( *) y := 1;"]), "E407")).toHaveLength(0);
  });
  it("W402: last code line without ;", () => {
    const r = run({ body: [{ step: "fill", init: true, action: ["valve [:=] 1;", "pump [:=] 1  // no semicolon", "", "// final comment", "(* and block *)"] }] });
    const d = byCode(r, "W402");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("the action of `fill` doesn't end with `;`");
    expect(d[0]!.span.line).toBe(3);
  });
  it("W402 is not reported when the last statement ends with ; (even with a comment)", () => {
    expect(codes(act(["x := 1; // done", "// more"]))).not.toContain("W402");
    expect(codes(act(["IF a THEN", "  x := 1;", "END_IF;"]))).not.toContain("W402");
    expect(codes(act(["IF a THEN", "  x := 1;", "END_IF"]))).toContain("W402");
    expect(codes(act(["// only a comment"]))).not.toContain("W402");
  });
  it("W403: x = value; as a statement", () => {
    const r = act(["valve = 1;", "IF level = 3 THEN", "  q := 1;", "END_IF;", "w := (a = b);"]);
    const d = byCode(r, "W403");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`valve = 1;` compares and does nothing; did you mean `:=`?");
    expect(d[0]!.span).toMatchObject({ line: 2, col: 3 });
  });
  it("W403 also after THEN on the same line", () => {
    const r = act(["IF a THEN x = 1; END_IF;"]);
    expect(byCode(r, "W403")).toHaveLength(1);
    expect(byCode(r, "W403")[0]!.message).toContain("`x = 1;`");
  });
});

describe("tag declarations (7.4)", () => {
  it("description goes into TagInfo and declared=true only with a type", () => {
    const r = act(["start := 1;", "n := 5;"], {
      tagDecls: [{ name: "start", description: "Green button" }, { name: "n", type: "DINT", description: "Counter" }],
    });
    expect(r.tags.find((t) => t.name === "start")).toMatchObject({ declared: false, description: "Green button", type: "BOOL" });
    expect(r.tags.find((t) => t.name === "n")).toMatchObject({ declared: true, description: "Counter", type: "DINT" });
  });
  it("E408: declared twice with different types", () => {
    const r = act(["count := 5;"], { tagDecls: [{ name: "count", type: "DINT" }, { name: "Count", type: "REAL" }] });
    const d = byCode(r, "E408");
    expect(d).toHaveLength(1);
    expect(d[0]!.span).toEqual({ line: 2, col: 5 });
    expect(d[0]!.message).toContain("tag `Count` declared twice with different types");
  });
  it("declaring twice with the same type is fine", () => {
    const r = act(["count := 5;"], { tagDecls: [{ name: "count", type: "DINT" }, { name: "count", type: "DINT" }] });
    expect(codes(r)).not.toContain("E408");
  });
  it("W404: declared but never used; not part of the tag list", () => {
    const r = act(["a := 1;"], { tagDecls: [{ name: "spare", type: "BOOL" }] });
    const d = byCode(r, "W404");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("tag `spare` is declared but never used");
    expect(d[0]!.span).toEqual({ line: 1, col: 5 });
    expect(r.tags.map((t) => t.name)).toEqual(["a"]);
  });
  it("the declaration spelling is the first spelling", () => {
    const r = act(["valve := 1;", "VALVE := 0;"], { tagDecls: [{ name: "Valve", type: "BOOL" }] });
    expect(r.tags[0]!.name).toBe("Valve");
    expect(r.tags[0]!.uses).toHaveLength(2);
  });
});

describe("W400 / W401", () => {
  it("W400: used once, with a suggestion within edit distance 2", () => {
    const r = run({
      body: [
        { step: "s0", init: true, action: ["start_btn := 1;", "x := start_btn;"] },
        { tran: "strat_btn" },
      ],
    });
    const d = byCode(r, "W400").filter((x) => x.message.includes("strat_btn"));
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`strat_btn` is used only once; did you mean `start_btn`?");
    expect(d[0]!.span.line).toBe(4);
  });
  it("W400 does not fire when nothing established is close", () => {
    const r = act(["alpha := 1;", "alpha := 0;", "totally_other := 1;"]);
    expect(byCode(r, "W400")).toHaveLength(0);
  });
  it("W400 does not fire for look-alike pairs that are both used once", () => {
    const r = act(["valve_a [:=] 1;", "valve_b [:=] 1;"]);
    expect(byCode(r, "W400")).toHaveLength(0);
  });
  it("W400 does not fire for tags used twice, nor for declared tags", () => {
    expect(codes(act(["a := 1;", "a := 0;"]))).not.toContain("W400");
    expect(codes(act(["a := 1;"], { tagDecls: [{ name: "a", type: "BOOL" }] }))).not.toContain("W400");
  });
  it("W400 suggestions can name declared but unused tags", () => {
    const r = act(["strat_btn := 1;"], { tagDecls: [{ name: "start_btn", type: "BOOL" }] });
    expect(byCode(r, "W400")[0]!.message).toContain("did you mean `start_btn`?");
  });
  it("W400 does not fire for very short, unrelated names", () => {
    const r = act(["x := 1;", "x := 0;", "y := 1;"]);
    expect(byCode(r, "W400")).toHaveLength(0);
  });
  it("W401: same tag with different capitalization; first spelling kept, warns at the later one", () => {
    const r = act(["valve := 1;", "Valve := 0;", "VALVE := 0;", "Valve := 1;"]);
    const d = byCode(r, "W401");
    expect(d).toHaveLength(2);
    expect(d[0]!.message).toBe("`valve` and `Valve` are the same tag; the first spelling is used");
    expect(d[0]!.span).toMatchObject({ line: 3, col: 3 });
    expect(d[1]!.span).toMatchObject({ line: 4, col: 3 });
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0]!.name).toBe("valve");
    expect(r.tags[0]!.uses).toHaveLength(4);
  });
});

describe("robustness", () => {
  it("empty chart and steps without actions", () => {
    expect(analyzeEmpty()).toEqual({ tags: [], diagnostics: [], calls: [] });
  });
  it("garbage ST never throws", () => {
    const garbage = ["))) ((( ]]] [[[", "x := := := ;;;", "'unterminated", "(* open", "a.b.c.d[1][2].e", "1.2.3 .. ..", "IF IF THEN THEN", "@ # $ % ^", "f(", "f(,,,)", ":= 1", "x :="];
    for (const g of garbage) {
      expect(() => act([g])).not.toThrow();
      expect(() => cond(g)).not.toThrow();
    }
  });
  it("diagnostics are sorted by position", () => {
    const r = act(["a[1] := 1;", "b.c := 1;", "d = 1;"]);
    const lines = r.diagnostics.map((d) => d.span.line);
    expect([...lines].sort((x, y) => x - y)).toEqual(lines);
  });
});

import { analyzeTags } from "../../src/tags/index.js";
function analyzeEmpty() {
  return analyzeTags({ tagDecls: [], body: [] });
}

describe("Studio name rules for tags used in ST", () => {
  it("E102 for a tag name longer than 40 characters", () => {
    const long = "a".repeat(41);
    expect(codes(act([`${long} := 1;`]))).toContain("E102");
  });
  it("E103 for `__` or a trailing `_`", () => {
    expect(codes(act(["my__tag := 1;"]))).toContain("E103");
    expect(codes(act(["mytag_ := 1;"]))).toContain("E103");
  });
  it("no name error for a valid 40-character name", () => {
    const ok = "a".repeat(40);
    const c = codes(act([`${ok} := 1;`]));
    expect(c).not.toContain("E102");
    expect(c).not.toContain("E103");
  });
});
