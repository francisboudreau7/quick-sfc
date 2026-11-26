/** Several routines and calls (SPEC §4.5): parse, checks, operands, L5X, ASCII. */
import { describe, expect, it } from "vitest";
import { compile, exportL5X, showAscii } from "../../src/compile.js";
import { checkL5X } from "../../src/l5x/index.js";
import { blockText, descendants, parseXml } from "../../src/l5x/xml.js";
import { parse } from "../../src/parse/index.js";
import { rewriteCalls } from "../../src/tags/index.js";

const src = (...lines: string[]) => lines.join("\n");
const codes = (source: string) => compile(source, { fileName: "t.qsfc" }).diagnostics.map((d) => d.code);
const DATE = new Date(2026, 10, 26, 12, 0, 0);

const TANK = src(
  "program tank",
  "",
  "st main",
  "  // run everything",
  "  call fill_seq;",
  "  JSR(alarms, 0);",
  "  lamp_on := fill.X;",
  "",
  "sfc fill_seq",
  "init idle",
  "  motor := 0;",
  "-- start_btn",
  "step fill 5s",
  "  valve [:=] 1;",
  "  call alarms;",
  "-- fill.DN -> idle",
  "",
  "st alarms",
  "  alarm := level_high AND NOT motor;",
);

describe("parse: routines", () => {
  it("splits the file at routine headers", () => {
    const { program, diagnostics } = parse(TANK);
    expect(diagnostics).toEqual([]);
    expect(program.header?.text).toBe("tank");
    expect(program.routines.map((r) => `${r.kind} ${r.kind === "st" ? r.name.text : r.name?.text}`)).toEqual([
      "st main",
      "sfc fill_seq",
      "st alarms",
    ]);
    const main = program.routines[0]!;
    expect(main.kind === "st" && main.body.map((l) => l.text)).toEqual([
      "// run everything",
      "call fill_seq;",
      "JSR(alarms, 0);",
      "lamp_on := fill.X;",
    ]);
  });

  it("ST bodies: blank lines kept inside, trailing comments dropped, `tag` lines anywhere", () => {
    const { program, diagnostics } = parse(src(
      "st a",
      "",
      "    x := 1;",
      "",
      "      y := 2;",
      "    // about the next routine",
      "tag z : DINT",
      "st b",
    ));
    expect(diagnostics).toEqual([]);
    const a = program.routines[0]!;
    expect(a.kind === "st" && a.body.map((l) => l.text)).toEqual(["x := 1;", "", "  y := 2;"]);
    expect(a.kind === "st" && a.body[0]!.span).toEqual({ line: 3, col: 5, endLine: 3, endCol: 12 });
    expect(program.tagDecls.map((d) => d.name.text)).toEqual(["z"]);
  });

  it("`st := 1;` and `st.x` are ST, not headers", () => {
    const { program } = parse(src("init a", "  st := 1;", "  st.x := 1;", "-- TRUE -> a"));
    expect(program.routines).toHaveLength(1);
  });

  it("E222: structure lines in an ST routine", () => {
    expect(codes(src("st a", "  x := 1;", "step s", "-- TRUE", "select", "|", "end"))).toEqual([
      "E222", "E222", "E222", "E222", "E222",
    ]);
  });

  it("E101: header without a name", () => {
    expect(codes("st")).toContain("E101");
    expect(codes("program")).toContain("E101");
  });

  it("auto transition names are unique across routines", () => {
    const r = compile(src("sfc a", "init a1", "-- x -> a1", "sfc b", "init b1", "-- y -> b1", "st m"));
    const names = r.program.routines.flatMap((x) =>
      x.kind === "sfc" ? x.chart.body.filter((e) => e.kind === "transition").map((e) => e.name.text) : [],
    );
    expect(names).toEqual(["T1", "T2"]);
  });
});

describe("checks across routines", () => {
  it("a valid program has no problems", () => {
    expect(compile(TANK).diagnostics).toEqual([]);
  });

  it("E600: unknown routine, with a suggestion", () => {
    const d = compile(src("st main", "  call fil_seq;", "sfc fill_seq", "init a", "-- TRUE -> a")).diagnostics;
    expect(d.map((x) => x.code)).toEqual(["E600", "W600"]);
    expect(d[0]!.message).toContain("did you mean `fill_seq`");
    expect(codes(src("init a", "  JSR(nowhere, 0);", "-- TRUE -> a"))).toEqual(["E600"]);
  });

  it("E601 / E602: bad call statements", () => {
    expect(codes(src("st m", "  call;", "  call a b;"))).toEqual(["E601", "E601"]);
    expect(codes(src("init a", "-- call m -> a", "st m", "  x := 1;"))).toEqual(["E602", "W600"]);
  });

  it("W600, W601, W602, W603", () => {
    expect(codes(src("st main", "  x := 1;", "st lonely", "  y := 1;"))).toEqual(["W600"]);
    expect(codes(src("st main", "  call main;"))).toEqual(["W601"]);
    expect(codes(src("st main", "  call b;", "st b", "  call main;"))).toEqual(["W602"]);
    expect(codes(src("st main", "  call b;", "st b"))).toEqual(["W603"]);
  });

  it("E309: names shared across routines", () => {
    const d = compile(src("sfc a", "init s", "-- TRUE -> s", "sfc b", "init s", "-- TRUE -> s", "st main")).diagnostics;
    expect(d.filter((x) => x.code === "E309").map((x) => x.message)).toEqual([
      "name `s` is already used by the step at line 2 (routine `a`)",
    ]);
    expect(codes(src("st main", "  call a;", "st a", "  x := 1;", "st A"))).toContain("E309");
    expect(codes(src("st main", "  call s;", "sfc s", "init s", "-- TRUE -> s"))).toContain("E309");
  });

  it("E303: a jump can't leave its routine", () => {
    const d = compile(src("st m", "  call a;", "  call b;", "sfc a", "init x", "-- TRUE -> y", "sfc b", "init y", "-- TRUE -> y"))
      .diagnostics;
    const e = d.find((x) => x.code === "E303")!;
    expect(e.message).toBe("jump target `y` is in routine `b`; a jump can't leave its routine");
  });

  it("E410: a routine used as a tag", () => {
    const d = compile(src("st m", "  x := alarms;", "  call alarms;", "st alarms", "  y := 1;")).diagnostics;
    expect(d.map((x) => x.code)).toEqual(["E410"]);
    expect(d[0]!.hint).toBe("run it with `call alarms;`");
  });

  it("E200: an SFC routine with no steps", () => {
    const d = compile(src("st m", "  call s;", "sfc s")).diagnostics;
    expect(d.map((x) => x.code)).toEqual(["E200"]);
    expect(d[0]!.message).toBe("SFC routine `s` has no steps");
  });

  it("routine names are not tags; step members are readable from any routine", () => {
    const r = compile(TANK);
    expect(r.tags.map((t) => `${t.name}:${t.type}`)).toEqual([
      "alarm:BOOL", "lamp_on:BOOL", "level_high:BOOL", "motor:BOOL", "start_btn:BOOL", "valve:BOOL",
    ]);
  });

  it("calls and callers per routine", () => {
    const r = compile(TANK);
    expect(r.routines.map((x) => [x.name, x.calls, x.calledBy, x.lines])).toEqual([
      ["main", ["fill_seq", "alarms"], [], { from: 3, to: 8 }],
      ["fill_seq", ["alarms"], ["main"], { from: 9, to: 17 }],
      ["alarms", [], ["main", "fill_seq"], { from: 18, to: 19 }],
    ]);
  });
});

describe("operands across SFC routines", () => {
  it("continue from one SFC routine to the next", () => {
    const r = compile(src("sfc a", "init a1", "-- x", "step a2", "-- y -> a1", "sfc b", "init b1", "-- z -> b1", "st m", "  call a;", "  call b;"));
    const g = r.routines.map((x) => x.graph);
    expect(g[0]!.steps.map((s) => s.index)).toEqual([0, 1]);
    expect(g[1]!.steps.map((s) => s.index)).toEqual([2]);
    expect(g[1]!.transitions.map((t) => t.index)).toEqual([2]);
    expect(r.graph).toBe(g[0]);
  });
});

describe("L5X: several routines", () => {
  const out = exportL5X(TANK, { fileName: "tank.qsfc", exportDate: DATE });
  const xml = out.text!;
  const root = parseXml(xml);

  it("passes the self-check", () => {
    expect(out.diagnostics).toEqual([]);
    expect(checkL5X(xml)).toEqual([]);
  });

  it("program name, main routine, routine order and types", () => {
    const program = descendants(root, "Program")[0]!;
    expect(program.attrs["Name"]).toBe("tank");
    expect(program.attrs["MainRoutineName"]).toBe("main");
    expect(descendants(root, "Routine").map((r) => `${r.attrs["Name"]}:${r.attrs["Type"]}`)).toEqual([
      "main:ST", "fill_seq:SFC", "alarms:ST",
    ]);
  });

  it("ST routine lines, with `call` rewritten and step references as operands", () => {
    const main = descendants(root, "Routine")[0]!;
    expect(descendants(main, "Line").map(blockText)).toEqual([
      "// run everything",
      "JSR(fill_seq,0);",
      "JSR(alarms, 0);",
      "lamp_on := Step_001.X;",
    ]);
  });

  it("`call` in an SFC action", () => {
    const sfc = descendants(root, "Routine")[1]!;
    expect(descendants(sfc, "Line").map(blockText)).toContain("JSR(alarms,0);");
  });

  it("an empty ST routine gets one empty line", () => {
    const x = exportL5X(src("st main", "  call b;", "st b"), { fileName: "p.qsfc", exportDate: DATE }).text!;
    const b = descendants(parseXml(x), "Routine")[1]!;
    expect(descendants(b, "Line").map(blockText)).toEqual([""]);
    expect(checkL5X(x)).toEqual([]);
  });

  it("program name defaults to the main routine; --program overrides", () => {
    const body = src("st cycle", "  call s;", "sfc s", "init a", "-- TRUE -> a");
    const a = exportL5X(body, { fileName: "x.qsfc", exportDate: DATE }).text!;
    expect(descendants(parseXml(a), "Program")[0]!.attrs["Name"]).toBe("cycle");
    const b = exportL5X(`program p\n${body}`, { fileName: "x.qsfc", programName: "q", exportDate: DATE }).text!;
    expect(descendants(parseXml(b), "Program")[0]!.attrs["Name"]).toBe("q");
  });

  it("a header-less first routine is named after the file, and can't clash with a header", () => {
    const ok = exportL5X(src("init a", "  call b;", "-- TRUE -> a", "st b", "  x := 1;"), { fileName: "my-chart.qsfc", exportDate: DATE });
    expect(descendants(parseXml(ok.text!), "Routine").map((r) => r.attrs["Name"])).toEqual(["my_chart", "b"]);
    const clash = exportL5X(src("init a", "  call b;", "-- TRUE -> a", "st b", "  x := 1;"), { fileName: "b.qsfc" });
    expect(clash.text).toBeUndefined();
    expect(clash.diagnostics.map((d) => d.code)).toEqual(["E502"]);
  });

  it("checkL5X reports a JSR to a missing routine", () => {
    expect(checkL5X(xml.replace("JSR(alarms, 0);", "JSR(nowhere, 0);"))).toEqual(["JSR to nowhere has no routine"]);
  });
});

describe("rewriteCalls", () => {
  it.each([
    ["call a;", "JSR(a,0);"],
    ["  CALL  fill_seq ; // call x", "  JSR(fill_seq,0) ; // call x"],
    ["IF x THEN call a; END_IF;", "IF x THEN JSR(a,0); END_IF;"],
    ["msg := 'call a';", "msg := 'call a';"],
    ["recall a;", "recall a;"],
    ["x.call := 1;", "x.call := 1;"],
  ])("%s", (input, expected) => {
    expect(rewriteCalls(input)).toBe(expected);
  });
});

describe("show: several routines", () => {
  it("prints every routine with its calls", () => {
    const { text } = showAscii(TANK);
    expect(text).toContain("== st main (main) ==\ncalls: fill_seq, alarms\n\n  // run everything");
    expect(text).toContain("== sfc fill_seq ==\ncalled by: main\ncalls: alarms\n");
    expect(text).toContain("== st alarms ==\ncalled by: main, fill_seq\n\n  alarm := level_high AND NOT motor;");
  });
});
