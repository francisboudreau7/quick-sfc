/** Print / PDF view (Phase 4c): the print model and its HTML. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile.js";
import { buildPrintModel, DEFAULT_PRINT, isoDate, printHtml, type PrintOptions } from "../../app/print.js";

const DATE = new Date(2026, 10, 27, 15, 30);

function model(source: string, include: PrintOptions = DEFAULT_PRINT) {
  const r = compile(source, { fileName: "tank.qsfc" });
  return buildPrintModel({
    program: r.program,
    routines: r.routines,
    tags: r.tags,
    source,
    date: DATE,
    include,
    diagram: (i) => (r.routines[i]?.graph ? `<svg data-routine="${r.routines[i]!.name}"></svg>` : undefined),
  });
}

describe("buildPrintModel", () => {
  it("title block from the file header (tp13)", () => {
    const m = model(readFileSync("testpack/tp13_ux.qsfc", "utf8"));
    expect(m.title).toBe("Tank filling");
    expect(m.course).toBe("GEI-243");
    expect(m.author).toBe("Francis B.");
    expect(m.date).toBe("2026-11-27");
    expect(m.program).toBe("program tp13_ux");
    expect(m.routines).toHaveLength(1);
  });
  it("tags with type, I/O address and description; code with line numbers from line 1", () => {
    const src = readFileSync("testpack/tp13_ux.qsfc", "utf8");
    const r = model(src).routines[0]!;
    expect(r.svg).toContain("<svg");
    expect(r.tags.map((t) => [t.name, t.type, t.address, t.description])).toEqual([
      ["count", "DINT", "", ""],
      ["level_ok", "BOOL", "Local:1:I.Data.1", "Level switch"],
      ["start_btn", "BOOL", "Local:1:I.Data.0", "Start button"],
      ["valve", "BOOL", "Local:2:O.Data.3", "Fill valve"],
    ]);
    expect(r.code[0]).toEqual({ n: 1, text: src.split(/\r?\n/)[0] });
    expect(r.code[r.code.length - 1]!.text.trim()).toBe("end");
  });
  it("without a title: the program name, else the routine name", () => {
    expect(model("program tank\nsfc fill\ninit a\n-- x -> a").title).toBe("tank");
    expect(model("init a\n-- x -> a").title).toBe("tank");
    expect(model("init a\n-- x -> a").program).toBe("program tank");
    expect(model("init a\n-- x -> a").course).toBeUndefined();
  });
  it("several routines: each with its own tags and code", () => {
    const src = ["st main", "  call fill;", "  lamp := x;", "  // end of main", "", "sfc fill", "init a", "-- x -> a", ""].join("\n");
    const m = model(src);
    expect(m.routines.map((r) => [r.name, r.kind])).toEqual([
      ["main", "st"],
      ["fill", "sfc"],
    ]);
    expect(m.routines[0]!.tags.map((t) => t.name)).toEqual(["lamp", "x"]);
    expect(m.routines[1]!.tags.map((t) => t.name)).toEqual(["x"]);
    expect(m.routines[0]!.code.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(m.routines[1]!.code.map((l) => l.n)).toEqual([6, 7, 8]);
    expect(m.routines[0]!.svg).toBeUndefined();
    expect(m.routines[1]!.svg).toContain("fill");
  });
  it("the checkboxes leave parts out; an SFC routine with errors has a note instead of its diagram", () => {
    const m = model("init a\n-- x -> a", { diagram: false, tags: true, code: false });
    expect(m.routines[0]!.svg).toBeUndefined();
    expect(m.routines[0]!.code).toEqual([]);
    expect(m.routines[0]!.tags).toHaveLength(1);
    const bad = model("init a\n-- x -> nowhere");
    expect(bad.routines[0]!.noDiagram).toMatch(/errors/);
  });
});

describe("printHtml", () => {
  it("title block, diagram, tag table and code, escaped", () => {
    const html = printHtml(model('program t "A & B"\ncourse "C<1>"\ninit a\n  v := 1;\n-- x -> a'));
    expect(html).toContain("<h1>A &amp; B</h1>");
    expect(html).toContain("C&lt;1&gt; · 2026-11-27");
    expect(html).toContain("program t");
    expect(html).toContain('<figure class="pv-diagram"><svg');
    expect(html).toContain("<th>I/O address</th>");
    expect(html).toContain('<td class="pv-mono">—</td>');
    expect(html).toContain('<span class="pv-ln">4</span>  v := 1;');
  });
  it("leaves out what is not ticked", () => {
    const html = printHtml(model("init a\n-- x -> a", { diagram: false, tags: false, code: true }));
    expect(html).not.toContain("pv-diagram");
    expect(html).not.toContain("<h3>Tags</h3>");
    expect(html).toContain("<h3>Code</h3>");
  });
});

describe("isoDate", () => {
  it("local date, zero-padded", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
