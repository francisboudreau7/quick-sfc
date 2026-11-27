/** Phase 4c syntax in the editor: highlighting and completion (SPEC §4.4, §4.5, §7.3, §7.6). */
import { describe, expect, it } from "vitest";
import { completeLine, type CompletionInfo } from "../../app/complete.js";
import { indentAfter, indentStructure, ioStateAfter, lineKind, tokenizeLine, type TokKind } from "../../app/highlight.js";

function toks(line: string, inIo = false): Array<[string, TokKind]> {
  return tokenizeLine(line, { inIo }).map((t) => [line.slice(t.from, t.to), t.kind]);
}

/** Tokens of every line, with the io state carried from line to line as the editor does. */
function doc(...lines: string[]): Array<Array<[string, TokKind]>> {
  let io = false;
  return lines.map((l) => {
    const here = io;
    io = ioStateAfter(l, io);
    return toks(l, here);
  });
}

describe("highlight: program title, course, author", () => {
  it("the program title is a string", () => {
    expect(toks('program tank "Tank filling" // x')).toEqual([
      ["program", "kw"],
      ["tank", "def"],
      ['"Tank filling"', "string"],
      ["// x", "comment"],
    ]);
  });

  it("course and author are keywords with a string; `course := 1;` is ST", () => {
    expect(lineKind('course "GEI-243"').kind).toBe("meta");
    expect(toks('course "GEI-243"')).toEqual([["course", "kw"], ['"GEI-243"', "string"]]);
    expect(toks('  AUTHOR "Francis B."  // me')).toEqual([["AUTHOR", "kw"], ['"Francis B."', "string"], ["// me", "comment"]]);
    expect(lineKind("course := 1;").kind).toBe("action");
    expect(toks("course := 1;")).toEqual([["course", "ident"], [":=", "op"], ["1", "number"], [";", "punct"]]);
  });
});

describe("highlight: io block", () => {
  it("the io line, entries (name, address, description) and end", () => {
    expect(doc(
      "io  // I/O",
      '  start_btn  Local:1:I.Data.0  "Start"  // green',
      "  // note",
      "  level Rack1:I.Data[2].5",
      "end",
      "  x := 1;",
    )).toEqual([
      [["io", "kw"], ["// I/O", "comment"]],
      [["start_btn", "def"], ["Local:1:I.Data.0", "address"], ['"Start"', "string"], ["// green", "comment"]],
      [["// note", "comment"]],
      [["level", "def"], ["Rack1:I.Data[2].5", "address"]],
      [["end", "kw"]],
      [["x", "ident"], [":=", "op"], ["1", "number"], [";", "punct"]],
    ]);
  });

  it("ioStateAfter: opened by `io`, closed by `end` or by a structure line (missing end)", () => {
    expect(ioStateAfter("io", false)).toBe(true);
    expect(ioStateAfter("  a Local:1:I.Data.0", true)).toBe(true);
    expect(ioStateAfter("", true)).toBe(true);
    expect(ioStateAfter("end", true)).toBe(false);
    expect(ioStateAfter("step fill", true)).toBe(false);
    expect(ioStateAfter("-- go", true)).toBe(false);
    expect(ioStateAfter("  a Local:1:I.Data.0", false)).toBe(false);
    expect(ioStateAfter("io := 1;", false)).toBe(false);
    // a structure line inside a block missing its end is highlighted as usual
    expect(doc("io", "step fill")[1]).toEqual([["step", "kw"], ["fill", "def"]]);
  });

  it("indentation: entries under `io`, `end` back to its column", () => {
    expect(indentAfter("  io")).toBe(4);
    expect(indentStructure("end", ["    a Local:1:I.Data.0", "  io"])).toBe(2);
    expect(indentAfter('course "x"')).toBe(0);
  });
});

describe("highlight: after and readable members in conditions", () => {
  it("`after` is a keyword and its duration a duration", () => {
    expect(toks("-- after 5s AND level_ok -> idle")).toEqual([
      ["--", "kw"],
      ["after", "kw"],
      ["5s", "duration"],
      ["AND", "stkw"],
      ["level_ok", "ident"],
      ["->", "arrow"],
      ["idle", "target"],
    ]);
    expect(toks("-- t: NOT after 1m30s")).toEqual([
      ["--", "kw"],
      ["t", "label"],
      [":", "punct"],
      ["NOT", "stkw"],
      ["after", "kw"],
      ["1m30s", "duration"],
    ]);
  });

  it("a bad duration is a number; `after` alone, in a string or as a member is not a keyword", () => {
    expect(toks("-- after 5")).toEqual([["--", "kw"], ["after", "kw"], ["5", "number"]]);
    expect(toks("-- after AND x").map(([, k]) => k)).toEqual(["kw", "ident", "stkw", "ident"]);
    expect(toks("-- s = 'after 5s'").map(([, k]) => k)).toEqual(["kw", "ident", "op", "string"]);
    expect(toks("-- x.after").map(([, k]) => k)).toEqual(["kw", "ident", "punct", "member"]);
    expect(toks("init after")).toEqual([["init", "kw"], ["after", "def"]]);
  });

  it("readable members are members", () => {
    expect(toks("-- fill.done OR fill.time > 2000")).toEqual([
      ["--", "kw"],
      ["fill", "ident"],
      [".", "punct"],
      ["done", "member"],
      ["OR", "stkw"],
      ["fill", "ident"],
      [".", "punct"],
      ["time", "member"],
      [">", "op"],
      ["2000", "number"],
    ]);
  });
});

describe("complete: Phase 4c", () => {
  const info: CompletionInfo = {
    steps: [{ name: "idle", initial: true }, { name: "fill", presetMs: 5000 }],
    tags: [{ name: "level_ok", type: "BOOL", declared: false, uses: [{ line: 3, col: 4 }, { line: 9, col: 4 }] }],
  };
  const at = (text: string, opts: { explicit?: boolean } = {}) => {
    const pos = text.indexOf("|");
    const line = text.slice(0, pos) + text.slice(pos + 1);
    const r = completeLine(line, pos, info, opts);
    return r && { ...r, labels: r.options.map((o) => o.label), word: line.slice(r.from, r.to) };
  };

  it("readable members come first after `step.`", () => {
    expect(at("-- fill.|")!.labels.slice(0, 5)).toEqual(["active", "done", "time", "first", "X"]);
    const done = at("-- idle.do|")!;
    expect(done.word).toBe("do");
    expect(done.options.find((o) => o.label === "done")!.info).toContain("W302");
    expect(at("-- fill.|")!.options.find((o) => o.label === "done")!.info).not.toContain("W302");
  });

  it("`after` in conditions, not in actions", () => {
    const c = at("-- af|")!;
    expect(c.labels).toContain("after");
    expect(c.options.find((o) => o.label === "after")!.apply).toBe("after ");
    expect(at("-- level_ok AND af|")!.labels).toContain("after");
    expect(at("  x := af|")!.labels).not.toContain("after");
  });

  it("io, course and author at the start of a line", () => {
    const r = at("i|")!;
    expect(r.labels).toContain("io");
    expect(at("cou|")!.labels).toContain("course");
    expect(at("aut|")!.options.find((o) => o.label === "author")!.apply).toBe('author "');
  });

  it("nothing inside the course string or after `io`", () => {
    expect(at('course "GE|"')).toBeNull();
    expect(at("io |")).toBeNull();
  });
});
