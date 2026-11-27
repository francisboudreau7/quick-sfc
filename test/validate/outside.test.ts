import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";

const diags = (src: string) => compile(src).diagnostics.map((d) => `${d.span.line}:${d.code}`);
const errors = (src: string) => compile(src).diagnostics.filter((d) => d.severity === "error").map((d) => `${d.span.line}:${d.code} ${d.message}`);
const l5x = (src: string) => {
  const r = exportL5X(src, { fileName: "t.qsfc" });
  if (!r.text) throw new Error(JSON.stringify(r.diagnostics));
  return r.text;
};

describe("routines outside the file: the uses line (SPEC §4.5)", () => {
  it("JSR / call to a routine on the uses line is fine; others are still E600", () => {
    const src = "uses INIT, Ext\n\nst main\n  JSR(INIT);\n  call Ext;\n  JSR(Nope);\n";
    expect(errors(src)).toEqual(["6:E600 `JSR(Nope, ...)`: there is no routine `Nope`"]);
  });

  it("parses names, (main), several lines; E210 after a routine or a second (main)", () => {
    const p = compile("uses A, B (main)\nuses C\n\nst main\n  x := 1;\n").program;
    expect(p.uses?.map((u) => `${u.name.text}${u.main ? "*" : ""}`)).toEqual(["A", "B*", "C"]);
    expect(diags("uses A (main), B (main)\nst main\n  x := 1;\n")).toContain("1:E210");
    expect(diags("st main\n  x := 1;\nuses A\n")).toContain("3:E210");
    expect(diags("uses A B\nst main\n  x := 1;\n")).toContain("1:E107");
  });

  it("a uses name can't also be a routine of the file (E309)", () => {
    expect(diags("uses main\nst main\n  x := 1;\n")).toContain("1:E309");
  });

  it("an outside main routine: no W600 or W602 for the routines of the file, no MainRoutineName in the L5X", () => {
    const src = "uses MainRoutine (main)\n\nst flash\n  x := 1;\n\nst other\n  JSR(flash);\n";
    expect(diags(src)).toEqual([]);
    expect(l5x(src)).not.toContain("MainRoutineName");
    expect(diags("uses MainRoutine (main)\nst a\n  JSR(MainRoutine);\n")).toContain("3:W602");
  });

  it("no W404 for an unused tag line when routines outside the file may use it", () => {
    expect(diags("tag t : TIMER 3s\ntag x : BOOL\nst a\n  y := 1;\n")).toContain("2:W404");
    expect(diags("uses Ladder\ntag x : BOOL\nst a\n  y := 1;\n")).not.toContain("2:W404");
  });
});

describe("SFR and SFP (SPEC §4.5)", () => {
  const prog = (code: string) => `uses Ext\n\nsfc main\ninit a\n  ${code}\n-- go\nstep b\n-- back -> a\n\nsfc seq\ninit idle\n-- start\nstep run\n-- stop -> idle\n\nst calc\n  z := 1;\n`;

  it("accepts a step of the routine, an outside routine's operand, Execute / Pause", () => {
    for (const ok of ["SFR(seq, idle);", "SFR(seq,run);", "SFR(Ext, Step_004);", "SFP(seq, Execute);", "SFP(Ext, pause);"]) {
      expect(errors(prog(ok))).toEqual([]);
    }
  });

  it("E603 for an ST routine, E604 for a wrong step or state", () => {
    expect(errors(prog("SFR(calc, idle);"))).toEqual(["5:E603 `SFR` needs an SFC routine; `calc` is an ST routine"]);
    expect(errors(prog("SFR(seq, a);"))).toEqual(["5:E604 `a` is not a step of `seq` (it is in `main`)"]);
    expect(errors(prog("SFR(Ext, idle);"))).toEqual(["5:E604 `idle` is a step of `seq`, not of `Ext`"]);
    expect(errors(prog("SFR(Ext, foo);"))).toEqual(["5:E604 `Ext` is not in this file: name its step by its operand"]);
    expect(errors(prog("SFP(seq, Run);"))).toEqual(["5:E604 `SFP(seq, ...)`: the second argument is `Execute` or `Pause`"]);
    expect(errors(prog("SFR(nope, idle);"))[0]).toMatch(/E600 `SFR\(nope, \.\.\.\)`: there is no routine `nope`/);
  });

  it("SFR / SFP don't count as calls (seq is still never called: W600 without uses)", () => {
    const src = prog("SFR(seq, idle);").replace("uses Ext\n", "");
    expect(diags(src)).toContain("9:W600");
  });

  it("exports SFR's step as its operand", () => {
    const out = l5x(prog("SFR(seq, run);"));
    expect(out).toContain("SFR(seq, Step_003);");
  });
});

describe("operands of other routines in the code (SPEC §7.3, §8.2)", () => {
  it("are not tags; their numbers are skipped by the file's steps, transitions and actions", () => {
    const out = l5x("init a\n  x := Step_000.DN;\n-- Tran_000 or Action_000.Q\nstep b\n-- Step_002.X -> a\n");
    expect(out).not.toMatch(/<Tag Name="(Step|Tran|Action)_000"/);
    const ops = [...out.matchAll(/Operand="(\w+)"/g)].map((m) => m[1]);
    expect(ops).toEqual(["Step_001", "Action_001", "Step_003", "Action_002", "Tran_001", "Tran_002"]);
  });

  it("E405 when the operand is an element of this file (pinned name)", () => {
    expect(errors("init s3\n-- Step_003.X\nstep b\n-- go -> s3\n")).toEqual([
      "2:E405 `Step_003` is the step `s3` of this file: write `s3`",
    ]);
  });
});
