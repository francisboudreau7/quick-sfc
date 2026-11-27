import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";
import { importL5X } from "../../src/import/index.js";

const date = new Date(2026, 0, 1);
const l5x = (source: string): string => {
  const r = exportL5X(source, { fileName: "demo.qsfc", exportDate: date });
  if (!r.text) throw new Error(JSON.stringify(r.diagnostics));
  return r.text;
};
const SMALL = "sfc demo\ninit a\n-- x\nstep b\n  on y\n-- z -> a\n";
const warnings = (r: ReturnType<typeof importL5X>) => r.notes.filter((n) => n.level === "warning").map((n) => n.text);

describe("operand pins (SPEC §8.2)", () => {
  const operands = (source: string) => {
    const r = compile(source);
    return {
      steps: r.routines.flatMap((x) => x.graph?.steps.map((s) => `${s.name}=${s.operand}`) ?? []),
      trans: r.routines.flatMap((x) => x.graph?.transitions.map((t) => `${t.name}=${t.operand}`) ?? []),
    };
  };

  it("s<N> and tr<N> keep their number, the others take the free ones in file order", () => {
    const o = operands("init s3\n-- tr7: x\nstep a\n-- y\nstep s0\n-- w -> s3\n");
    expect(o.steps).toEqual(["s3=3", "a=1", "s0=0"]);
    expect(o.trans).toEqual(["tr7=7", "T1=0", "T2=1"]);
  });

  it("t<N> is an ordinary name (a timer T4 is common), so it doesn't pin", () => {
    const o = operands("init a\n-- t7: x\nstep b\n-- y -> a\n");
    expect(o.trans).toEqual(["t7=0", "T1=1"]);
  });

  it("auto names T1, T2 never pin; s01 is an ordinary name", () => {
    const o = operands("init s01\n-- x\nstep b\n-- y -> s01\n");
    expect(o.steps).toEqual(["s01=0", "b=1"]);
    expect(o.trans).toEqual(["T1=0", "T2=1"]);
  });

  it("numbers across routines", () => {
    const o = operands("sfc one\ninit go\n-- x -> go\n\nsfc two\ninit s0\n-- y -> s0\n");
    expect(o.steps).toEqual(["go=1", "s0=0"]);
  });

  it("is written in the L5X", () => {
    expect(l5x("sfc demo\ninit s5\n-- tr9: x -> s5\n")).toMatch(/Operand="Step_005"[\s\S]*Operand="Tran_009"/);
  });

  it("a routine may be named like a qSFC keyword", () => {
    expect(compile("st main\n  call SFC;\n\nsfc SFC\ninit a\n-- x -> a\n").diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(compile("sfc AND\ninit a\n-- x -> a\n").diagnostics.some((d) => d.code === "E108")).toBe(true);
  });
});

describe("importL5X", () => {
  it("reads names back, and plain names from operands when there are none", () => {
    const xml = l5x(SMALL).replace(/<Description>\s*<!\[CDATA\[[ab]\]\]>\s*<\/Description>\s*/g, "").replace(/<!\[CDATA\[\/\/ [ab]\]\]>/g, "<![CDATA[]]>");
    const r = importL5X(xml);
    expect(r.errors).toBe(0);
    expect(r.source).toMatch(/^init s0$/m);
    expect(r.source).toMatch(/^step s1$/m);
    expect(r.source).toContain("-- z -> s0");
  });

  it("restores sugar only where the export gives the same text", () => {
    const r = importL5X(l5x("sfc demo\ntag n : DINT\ninit a\n  n := 1;\n  set k\n-- x\nstep b\n  on y\n  call sub;\n-- after 2s -> a\n\nst sub\n  q := 0;\n"));
    expect(r.source).toContain("  n := 1;");
    expect(r.source).toContain("  set k");
    expect(r.source).toContain("  on y");
    expect(r.source).toContain("  call sub;");
    expect(r.source).toContain("-- after 2s -> a");
    expect(r.source).toContain("  q := 0;");
  });

  it("keeps Studio's spelling when it isn't exactly the export's", () => {
    const xml = l5x(SMALL).replace("y [:=] 1;", "y[:=]1;").replace("<![CDATA[z]]>", "<![CDATA[b.T >= 3000;]]>");
    const r = importL5X(xml);
    expect(r.source).toContain("  y[:=]1;");
    expect(r.source).toContain("-- after 3s -> a");
  });

  it("names a routine it can't import on the uses line and keeps the calls to it (SPEC §4.5)", () => {
    const xml = l5x(readFileSync("testpack/tp08_routines.qsfc", "utf8")).replace('<Routine Name="alarms" Type="ST">', '<Routine Name="alarms" Type="RLL">');
    const r = importL5X(xml);
    expect(r.errors).toBe(0);
    expect(r.routines.find((x) => x.name === "alarms")).toMatchObject({ imported: false, type: "RLL" });
    expect(r.source).toMatch(/^uses alarms$/m);
    expect(r.source).toContain("  JSR(alarms,0);");
    expect(warnings(r).join("\n")).toContain("ladder routines come with Phase 5");
    const again = exportL5X(r.source, { fileName: "x.qsfc" });
    expect(again.diagnostics).toEqual([]);
    expect(again.text).toContain("JSR(alarms,0);");
  });

  it("keeps a main routine it can't import as the main one: uses main (main)", () => {
    const xml = l5x(readFileSync("testpack/tp08_routines.qsfc", "utf8")).replace('<Routine Name="main" Type="ST">', '<Routine Name="main" Type="RLL">');
    const r = importL5X(xml);
    expect(r.source).toMatch(/^uses main \(main\)$/m);
    expect(warnings(r).join("\n")).not.toContain("becomes the main routine");
    const again = exportL5X(r.source, { fileName: "x.qsfc" });
    // Studio refuses a MainRoutineName that is not in the file: left out
    expect(again.text).not.toContain("MainRoutineName");
  });

  it("a routine export (GEMMA.L5X shape): referenced routines on uses, outside steps kept as written", () => {
    const xml = l5x("sfc PRODUCTION_NORMALE\ninit a\n-- go\nstep b\n-- x -> a\n\nst INIT\n  y := 1;\n\nsfc GEMMA\ninit c\n  call INIT;\n  SFR(PRODUCTION_NORMALE, a);\n-- b.T > 5 or z\nstep d\n-- w -> c\n")
      .replace(/<Routine Name="(PRODUCTION_NORMALE|INIT)" Type="\w+">[\s\S]*?<\/Routine>/g, '<Routine Use="Reference" Name="$1">\r\n</Routine>');
    const r = importL5X(xml);
    expect(r.errors).toBe(0);
    expect(r.source).toContain("\nuses PRODUCTION_NORMALE (main), INIT\n");
    expect(r.source).toContain("SFR(PRODUCTION_NORMALE, Step_000);");
    expect(r.source).toContain("Step_001.T > 5");
    expect(r.notes.map((n) => n.text).join("\n")).toContain("not in this export");
  });

  it("writes text boxes as comments and a Stop as the end of the chain", () => {
    const xml = l5x(SMALL)
      .replace('<DirectedLink FromID="5" ToID="0" Show="true"/>', '<DirectedLink FromID="5" ToID="50"/>\r\n<Stop ID="50" X="200" Y="560" Operand="Stop_000"/>\r\n<TextBox ID="60" X="400" Y="100" Width="100"><![CDATA[Check the valve\r\nfirst]]></TextBox>\r\n<Attachment FromID="60" ToID="2"/>\r\n<TextBox ID="61" X="400" Y="300" Width="100"><![CDATA[General note]]></TextBox>');
    const r = importL5X(xml);
    expect(r.error).toBeUndefined();
    expect(r.errors).toBe(0);
    expect(r.source).toContain("// General note\ninit a");
    expect(r.source).toContain("// Check the valve\n// first\nstep b");
    expect(r.source).toMatch(/-- z\n\/\/ Studio Stop element Stop_000\nstep stop0\n/);
    expect(warnings(r).join("\n")).toContain("1 Stop element (Stop_000)");
  });

  it("writes an unknown qualifier as N, with a note", () => {
    const xml = l5x(readFileSync("testpack/tp12_qualifiers.qsfc", "utf8")).replace('Qualifier="Pulse"', 'Qualifier="PulseFalling"');
    const r = importL5X(xml);
    expect(r.errors).toBe(0);
    expect(r.source).toContain("// Studio qualifier: PulseFalling");
    expect(warnings(r).join("\n")).toContain("qualifier PulseFalling has no qSFC form yet");
  });

  it("lists the programs and imports the one asked for", () => {
    const one = l5x(SMALL);
    const prog = /<Program [\s\S]*<\/Program>/.exec(one)![0];
    const two = one.replace(prog, `${prog}\r\n${prog.replace(/Name="demo"/, 'Name="other"').replace('MainRoutineName="demo"', 'MainRoutineName="demo"')}`);
    expect(importL5X(two).programs).toEqual(["demo", "other"]);
    expect(importL5X(two, { program: "OTHER" }).program).toBe("other");
    expect(importL5X(two, { program: "nope" }).error).toContain("no program named nope");
  });

  it("refuses what isn't an L5X", () => {
    expect(importL5X("hello").error).toContain("not valid XML");
    expect(importL5X("<a/>").error).toContain("has no Program");
  });
});
