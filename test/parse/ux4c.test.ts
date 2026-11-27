/** Phase 4c language parts in the parser: program title, course/author, io block, `after` (SPEC §4.4, §4.5, §7.6). */
import { describe, expect, it } from "vitest";
import type { TransitionNode } from "../../src/model/ast.js";
import type { Diagnostic } from "../../src/model/diagnostics.js";
import { parse } from "../../src/parse/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const codes = (s: string): string[] => parse(s).diagnostics.map((d) => d.code);
const only = (s: string, code: string): Diagnostic[] => parse(s).diagnostics.filter((d) => d.code === code);
const chart = "init a\n-- go -> a";

describe("parse: program title and header lines", () => {
  it("reads `program name \"Title\"`", () => {
    const r = parse(src('program tank "Tank filling"  // comment', chart));
    expect(r.diagnostics).toEqual([]);
    expect(r.program.header?.text).toBe("tank");
    expect(r.program.title).toBe("Tank filling");
  });

  it("a title right after the name, escapes, and no title", () => {
    expect(parse(src('program tank"A \\"b\\""', chart)).program.title).toBe('A "b"');
    expect(parse(src("program tank", chart)).program.title).toBeUndefined();
    expect(codes(src('program tank "Title" extra', chart))).toEqual(["E107"]);
    expect(codes(src('program tank "Title', chart))).toEqual(["E106"]);
  });

  it("reads course and author, in any order, before the first routine", () => {
    const r = parse(src('author "Francis B."', 'course "GEI-243"', 'program tank "T"', chart));
    expect(r.diagnostics).toEqual([]);
    expect(r.program.meta).toEqual({ course: "GEI-243", author: "Francis B." });
    expect(r.program.routines).toHaveLength(1);
  });

  it("course and author are not part of any routine and leave the file without them unchanged", () => {
    const r = parse(src('course "x"', chart));
    expect(r.program.meta).toEqual({ course: "x" });
    expect(r.chart.body).toHaveLength(2);
    expect(parse(chart).program.meta).toBeUndefined();
  });

  it("E210: twice, or after the first routine", () => {
    const twice = only(src('course "a"', 'course "b"', chart), "E210");
    expect(twice).toHaveLength(1);
    expect(twice[0]!.message).toBe("the `course` line can appear only once");
    expect(parse(src('course "a"', 'course "b"', chart)).program.meta?.course).toBe("a");
    const late = only(src(chart, 'author "me"'), "E210");
    expect(late[0]!.message).toContain("`author` line must come before the first routine");
  });

  it("E107: the text must be in quotes", () => {
    expect(only(src("course GEI-243", chart), "E107")[0]!.message).toBe("unexpected text `GEI-243` after `course`");
    expect(only(src("author", chart), "E107")[0]!.message).toBe('`author` needs a text in quotes: `author "Your name"`');
    expect(codes(src('course "a" b', chart))).toEqual(["E107"]);
  });

  it("`course := 1;` in an action is ST, not a header line", () => {
    const r = parse(src("init a", "  course := 1;", "  author[2] := 0;", "-- go -> a"));
    expect(r.program.meta).toBeUndefined();
    expect(r.chart.body[0]!.kind === "step" && r.chart.body[0]!.action.map((l) => l.text)).toEqual(["course := 1;", "author[2] := 0;"]);
  });

  it("course, author and io are keywords: not valid names", () => {
    expect(codes("init io\n-- go -> io")).toContain("E108");
    expect(codes("init course\n-- go -> course")).toContain("E108");
    expect(codes('tag author "x"\n' + chart)).toContain("E108");
  });
});

describe("parse: io block", () => {
  const text = src(
    "io   // inputs and outputs",
    "  start_btn   Local:1:I.Data.0  \"Start button\"   // green",
    "",
    "  // a comment line",
    "  valve       Local:2:O.Data.3",
    "  level       Local:3:I.Ch0Data",
    "  spare       Rack1:I.Data[2].5",
    "end",
    chart,
  );

  it("reads every line: name, address, description, with spans", () => {
    const r = parse(text);
    expect(r.diagnostics).toEqual([]);
    const io = r.program.io!;
    expect(io.map((e) => [e.name.text, e.address.text, e.description])).toEqual([
      ["start_btn", "Local:1:I.Data.0", "Start button"],
      ["valve", "Local:2:O.Data.3", undefined],
      ["level", "Local:3:I.Ch0Data", undefined],
      ["spare", "Rack1:I.Data[2].5", undefined],
    ]);
    expect(io[0]!.name.span).toEqual({ line: 2, col: 3, endLine: 2, endCol: 12 });
    expect(io[0]!.address.span).toEqual({ line: 2, col: 15, endLine: 2, endCol: 31 });
    // the chart after `end` is read as usual
    expect(r.chart.body).toHaveLength(2);
  });

  it("several blocks, before and between routines, all program-wide", () => {
    const r = parse(src("io", "  a Local:1:I.Data.0", "end", "sfc one", chart, "io", "  b Local:1:I.Data.1", "end", "st two", "  x := a AND b;"));
    expect(r.diagnostics).toEqual([]);
    expect(r.program.io!.map((e) => e.name.text)).toEqual(["a", "b"]);
    expect(r.program.routines.map((x) => x.kind)).toEqual(["sfc", "st"]);
  });

  it("an io block inside an ST routine is not part of its body", () => {
    const r = parse(src("st main", "  x := 1;", "io", "  b Local:1:I.Data.1", "end", "  y := 2;"));
    expect(r.diagnostics).toEqual([]);
    const st = r.program.routines[0]!;
    expect(st.kind === "st" && st.body.map((l) => l.text)).toEqual(["x := 1;", "y := 2;"]);
  });

  it("an io block between a step and its actions ends the action block (E209 after it)", () => {
    const r = parse(src("init a", "  x := 1;", "io", "  b Local:1:I.Data.1", "end", "  y := 2;", "-- go -> a"));
    expect(r.diagnostics.map((d) => [d.code, d.span.line])).toEqual([["E209", 6]]);
    expect(r.diagnostics[0]!.message).toContain("it follows an `io` block");
    expect(r.chart.body[0]!.kind === "step" && r.chart.body[0]!.action.map((l) => l.text)).toEqual(["x := 1;"]);
  });

  it("`io := 1;` is ST (and io is a keyword for the tag analysis)", () => {
    const r = parse(src("init a", "  io := 1;", "-- go -> a"));
    expect(r.program.io).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
  });

  it("E413: missing or malformed address", () => {
    const missing = only(src("io", "  start_btn", "end", chart), "E413");
    expect(missing[0]!.message).toBe("I/O point `start_btn` has no address");
    for (const bad of ["Local:1:I.Data.", "Local::1", "1:I.Data.0", "Local:1:I.Data[x]", "Local:1:I-Data"]) {
      const d = only(src("io", `  x ${bad}`, "end", chart), "E413");
      expect(d, bad).toHaveLength(1);
      expect(d[0]!.message).toBe(`\`${bad}\` is not a valid I/O address`);
    }
    // the point is kept, so the tag still exists for the tag table
    expect(parse(src("io", "  x Local1", "end", chart)).program.io).toHaveLength(1);
  });

  it("E101 / E103 for a bad name, E107 for text after the description", () => {
    expect(codes(src("io", "  2x Local:1:I.Data.0", "end", chart))).toContain("E101");
    expect(codes(src("io", "  a__b Local:1:I.Data.0", "end", chart))).toContain("E103");
    expect(codes(src("io", '  a Local:1:I.Data.0 "d" more', "end", chart))).toEqual(["E107"]);
    expect(codes(src("io extra", "end", chart))).toEqual(["E107"]);
    expect(codes(src("io", "  a Local:1:I.Data.0", "end x", chart))).toEqual(["E107"]);
  });

  it("E206: a block without `end`, at the end of the file or before a structure line", () => {
    const eof = only(src(chart, "io", "  a Local:1:I.Data.0"), "E206");
    expect(eof[0]!.message).toBe("`io` at line 3 is never closed: add `end`");
    const r = parse(src("io", "  a Local:1:I.Data.0", chart));
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E206"]);
    expect(r.chart.body).toHaveLength(2); // the chart is still read
    expect(r.program.io).toHaveLength(1);
  });
});

describe("parse: after in a condition", () => {
  const cond = (c: string): TransitionNode => {
    const r = parse(`init a\n-- ${c}\nstep b\n-- go -> a`);
    return r.chart.body[1] as TransitionNode;
  };

  it("records each `after <duration>` with its offsets in the condition and its span", () => {
    const t = cond("after 5s AND level_ok");
    expect(t.condition.text).toBe("after 5s AND level_ok");
    expect(t.after).toEqual([{ ms: 5000, start: 0, end: 8, span: { line: 2, col: 4, endLine: 2, endCol: 12 } }]);
    const two = cond("x OR (AFTER  1m30s AND y) OR after 200ms");
    expect(two.after!.map((a) => [a.ms, two.condition.text.slice(a.start, a.end)])).toEqual([
      [90000, "AFTER  1m30s"],
      [200, "after 200ms"],
    ]);
  });

  it("named transitions and jumps keep their parts", () => {
    const r = parse("init a\n-- t: after 2s -> a");
    const t = r.chart.body[1] as TransitionNode;
    expect(r.diagnostics).toEqual([]);
    expect(t.name.text).toBe("t");
    expect(t.jump?.text).toBe("a");
    expect(t.after![0]!.ms).toBe(2000);
  });

  it("only before a duration: tags named after, after_x, x.after and strings are untouched", () => {
    for (const c of ["after", "after AND b", "after_x", "x.after", "my_after", "s = 'after 5s'"]) {
      expect(cond(c).after, c).toBeUndefined();
    }
  });

  it("E104 / E105 for a bad duration (the term is still recorded, without ms)", () => {
    expect(only("init a\n-- after 5 -> a", "E104")[0]!.span).toEqual({ line: 2, col: 10, endLine: 2, endCol: 11 });
    expect(codes("init a\n-- after 5d -> a")).toEqual(["E105"]);
    const t = parse("init a\n-- after 5 -> a").chart.body[1] as TransitionNode;
    expect(t.after).toEqual([{ start: 0, end: 7, span: { line: 2, col: 4, endLine: 2, endCol: 11 } }]);
  });
});
