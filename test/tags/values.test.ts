import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";

const errs = (src: string) => compile(src).diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`);
const tags = (src: string) => compile(src).tags.map((t) => `${t.name}:${t.type}=${t.initial ?? "-"}`);
const BODY = "init a\n  x := t.DN;\n-- go -> a\n";

describe("tag values (SPEC §7.4)", () => {
  it("reads a TIMER preset and the value of BOOL, DINT, REAL", () => {
    const src = `tag t : TIMER 1m30s "Fill timer"\ntag n : DINT = -5\ntag r : REAL = 1.5\ntag b : BOOL = TRUE\ntag z : BOOL = 0\ninit a\n  n := n + 1; r := r * 2.0; b := NOT b; z := 1;\n  x := t.DN;\n-- go -> a\n`;
    expect(errs(src)).toEqual([]);
    expect(tags(src)).toEqual(expect.arrayContaining(["t:TIMER=90000", "n:DINT=-5", "r:REAL=1.5", "b:BOOL=1", "z:BOOL=0"]));
    expect(compile(src).program.tagDecls[0]!.description).toBe("Fill timer");
  });

  it("accepts `= 3s` for a timer too", () => {
    expect(tags(`tag t : TIMER = 3s\n${BODY}`)).toContain("t:TIMER=3000");
  });

  it("checks the value against the type (E417)", () => {
    expect(errs(`tag n : DINT = 1.5\n${BODY}`)[0]).toMatch(/^E417 `1.5` is not a DINT value/);
    expect(errs(`tag n : DINT = 3000000000\n${BODY}`)[0]).toMatch(/^E417/);
    expect(errs(`tag b : BOOL = 2\n${BODY}`)[0]).toMatch(/^E417 `2` is not a BOOL value/);
    expect(errs(`tag r : REAL = abc\n${BODY}`)[0]).toMatch(/^E417 `abc` is not a REAL value/);
    expect(errs(`tag n : DINT =\n${BODY}`)[0]).toMatch(/^E417 the value is missing/);
    expect(errs(`tag n = 5\n${BODY}`)[0]).toMatch(/^E417 a value needs the tag's type first/);
    expect(errs(`tag t : TIMER 3\n${BODY}`)[0]).toMatch(/^E104/);
    expect(errs(`tag n : DINT 5\n${BODY}`)[0]).toMatch(/^E/);
  });

  it("an I/O point can't have a value", () => {
    expect(errs(`io\n  b  Local:1:I.Data.0\nend\ntag b : BOOL = 1\ninit a\n-- b -> a\n`)[0]).toMatch(/^E417 `b` is an I\/O point/);
  });

  it("a tag with a value exists even when unused, without W404", () => {
    const r = compile(`tag spare : TIMER 2s\ntag unused : DINT\n${BODY}`);
    expect(r.tags.map((t) => t.name)).toContain("spare");
    expect(r.tags.map((t) => t.name)).not.toContain("unused");
    expect(r.diagnostics.filter((d) => d.code === "W404").map((d) => d.message)).toEqual(["tag `unused` is declared but never used"]);
  });

  it("exports the values as Studio writes them", () => {
    const text = exportL5X(`tag t : TIMER 3s\ntag n : DINT = 7\ntag r : REAL = 1.5\ntag b : BOOL = 1\ninit a\n  n := 1; r := 2.0; b := 0;\n  x := t.DN;\n-- go -> a\n`, { fileName: "v.qsfc" }).text!;
    expect(text).toMatch(/<Tag Name="t"[^>]*>\s*<Data Format="L5K">\s*<!\[CDATA\[\[0,3000,0\]\]\]>[\s\S]*?Name="PRE" DataType="DINT" Radix="Decimal" Value="3000"/);
    expect(text).toMatch(/<Tag Name="n"[^>]*>\s*<Data Format="L5K">\s*<!\[CDATA\[7\]\]>\s*<\/Data>\s*<Data Format="Decorated">\s*<DataValue DataType="DINT" Radix="Decimal" Value="7"\/>/);
    expect(text).toMatch(/<!\[CDATA\[1\.50000000e\+000\]\]>[\s\S]*?Value="1\.5"/);
    expect(text).toMatch(/<Tag Name="b"[^>]*>\s*<Data Format="L5K">\s*<!\[CDATA\[1\]\]>/);
  });
});
