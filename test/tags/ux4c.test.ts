/** Phase 4c in the tag analysis: io block (SPEC §7.6), `after` (§4.4), readable step members (§7.3). */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/parse/index.js";
import { analyzeTags } from "../../src/tags/index.js";

const src = (...lines: string[]): string => lines.join("\n");
const analyze = (s: string) => analyzeTags(parse(s).program);
const codes = (s: string): string[] => analyze(s).diagnostics.map((d) => d.code);
const diags = (s: string, code: string) => analyze(s).diagnostics.filter((d) => d.code === code);
const tag = (s: string, name: string) => analyze(s).tags.find((t) => t.name === name);

describe("tags: io block", () => {
  const io = (...lines: string[]): string => src("io", ...lines.map((l) => `  ${l}`), "end");

  it("an I/O point is a tag with its address, even when the code never uses it", () => {
    const r = analyze(src(io('start_btn Local:1:I.Data.0 "Start"', "spare Local:1:I.Data.7"), "init a", "-- start_btn -> a"));
    expect(r.diagnostics).toEqual([]);
    expect(r.tags).toEqual([
      { name: "spare", type: "BOOL", declared: false, address: "Local:1:I.Data.7", uses: [] },
      {
        name: "start_btn",
        type: "BOOL",
        declared: false,
        description: "Start",
        address: "Local:1:I.Data.0",
        uses: [{ line: 6, col: 4, endLine: 6, endCol: 13 }],
      },
    ]);
  });

  it("a bit address is BOOL evidence: a numeric use is E404", () => {
    const d = diags(src(io("count Local:1:I.Data.0"), "init a", "  count := count + 1;", "-- TRUE -> a"), "E404");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("`count` is used as BOOL (line 2)");
  });

  it("a word address gives no type: the use decides (kept for the tag table)", () => {
    const s = src(io("level Local:3:I.Ch0Data"), "init a", "-- level > 50.5 -> a");
    expect(analyze(s).diagnostics).toEqual([]);
    expect(tag(s, "level")).toMatchObject({ type: "REAL", address: "Local:3:I.Ch0Data" });
    expect(tag(src(io("level Local:3:I.Ch0Data"), "init a", "-- level > 50 -> a"), "level")?.type).toBe("DINT");
  });

  it("a tag line with a type: BOOL for a bit, any type for a word; E414 otherwise", () => {
    expect(codes(src("tag start_btn : BOOL", io("start_btn Local:1:I.Data.0"), "init a", "-- start_btn -> a"))).toEqual([]);
    const word = src("tag level : REAL", io("level Local:3:I.Ch0Data"), "init a", "-- level > 1 -> a");
    expect(codes(word)).toEqual([]);
    expect(tag(word, "level")).toMatchObject({ type: "REAL", declared: true });
    const d = diags(src("tag count : DINT", io("count Local:1:I.Data.0"), "init a", "-- count > 1 -> a"), "E414");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`count` is mapped to the bit `Local:1:I.Data.0` but declared as DINT (line 1)");
    expect(d[0]!.span).toEqual({ line: 3, col: 9, endLine: 3, endCol: 25 });
    // no E404 on top of it
    expect(codes(src("tag count : DINT", io("count Local:1:I.Data.0"), "init a", "-- count > 1 -> a"))).toEqual(["E414"]);
  });

  it("descriptions: the io one wins over a tag line's; a tag line's is kept otherwise", () => {
    expect(tag(src('tag a "from tag"', io('a Local:1:I.Data.0 "from io"'), "init s", "-- a -> s"), "a")?.description).toBe("from io");
    expect(tag(src('tag a "from tag"', io("a Local:1:I.Data.0"), "init s", "-- a -> s"), "a")?.description).toBe("from tag");
  });

  it("a declared tag that is mapped is not W404 when unused", () => {
    expect(codes(src("tag a : BOOL", io("a Local:1:I.Data.0"), "init s", "-- TRUE -> s"))).toEqual([]);
  });

  it("E415: the same name twice (also across blocks, case-insensitive)", () => {
    const s = src(io("a Local:1:I.Data.0"), io("A Local:1:I.Data.1"), "init s", "-- a -> s");
    const d = diags(s, "E415");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`A` is already mapped to `Local:1:I.Data.0` (line 2)");
    expect(tag(s, "a")?.address).toBe("Local:1:I.Data.0");
  });

  it("the spelling of the io line is used (W401 for another one)", () => {
    const r = analyze(src(io("Start_Btn Local:1:I.Data.0"), "init s", "-- start_btn -> s"));
    expect(r.tags.map((t) => t.name)).toEqual(["Start_Btn"]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["W401"]);
  });

  it("names are shared: E410 for a step, E405 for a keyword or an operand name", () => {
    expect(codes(src(io("fill Local:1:I.Data.0"), "init fill", "-- TRUE -> fill"))).toContain("E410");
    expect(codes(src(io("Step_001 Local:1:I.Data.0"), "init s", "-- TRUE -> s"))).toContain("E405");
  });

  it("an I/O point counts as established for W400", () => {
    const d = diags(src(io("start_btn Local:1:I.Data.0"), "init s", "-- strat_btn -> s"), "W400");
    expect(d[0]!.message).toBe("`strat_btn` is used only once; did you mean `start_btn`?");
  });

  it("tags named like the new keywords are reserved (course, author, io), `after` is not", () => {
    expect(codes(src("init s", "  io := 1;", "-- TRUE -> s"))).toContain("E405");
    expect(codes(src("init s", "  course := 1;", "-- TRUE -> s"))).toContain("E405");
    expect(codes(src("init s", "  after := 1;", "-- after -> s"))).toEqual([]);
  });
});

describe("tags: after in a condition", () => {
  it("creates no tag and is a Boolean operand", () => {
    const r = analyze(src("init s", "step t", "-- after 5s AND level_ok", "step u", "-- NOT after 1s OR x -> s"));
    expect(r.diagnostics).toEqual([]);
    expect(r.tags.map((t) => [t.name, t.type])).toEqual([["level_ok", "BOOL"], ["x", "BOOL"]]);
  });

  it("other tags of the condition keep their positions", () => {
    const r = analyze(src("init s", "-- after 5s AND level_ok -> s"));
    expect(r.tags[0]!.uses).toEqual([{ line: 2, col: 17, endLine: 2, endCol: 25 }]);
  });

  it("`after` without a duration is a tag", () => {
    expect(analyze(src("init s", "-- after AND b -> s")).tags.map((t) => t.name)).toEqual(["after", "b"]);
  });
});

describe("tags: readable step members", () => {
  it(".active .done .time .first are step members, case-insensitive, everywhere", () => {
    const r = analyze(src(
      "init s 5s",
      "  IF s.First THEN n := s.TIME; END_IF;",
      "-- s.done AND s.active -> s",
      "st other",
      "  lamp := s.active;",
    ));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.tags.map((t) => t.name)).toEqual(["lamp", "n"]);
  });

  it("W302 for .done on a step without a preset", () => {
    const d = diags(src("init s", "-- s.done -> s"), "W302");
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toBe("`s.done` is used but `s` has no preset, so it is TRUE immediately");
  });

  it("E401 suggests readable members too, and lists them", () => {
    expect(diags(src("init s", "-- s.actve -> s"), "E401")[0]!.message).toBe("`s.actve`: steps have no member `actve` (did you mean `active`?)");
    expect(diags(src("init s", "-- s.zzzzzz -> s"), "E401")[0]!.hint).toContain("and active, done, time, first");
  });
});
