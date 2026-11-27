import { describe, expect, it } from "vitest";
import { compile, exportL5X } from "../../src/compile.js";

const diags = (src: string) => compile(src).diagnostics.map((d) => `${d.span.line}:${d.code}`);
const chart = "\ninit a\n  x := ejections + local_x;\n-- go: stop and e_stop\nstep b 2s\n-- back: b.DN -> a\n";
const CTRL = [
  "controller",
  "  tag stop : BOOL = 1",
  "  io",
  "    e_stop     Local:1:I.Data.15",
  "    ejections  b.Count",
  "  end",
  "  sfc tags a, go, b",
  "end",
  "",
  "tag local_x : DINT = 3",
].join("\n");

/** Tag names in the controller's context <Tags> and in the program's <Tags>. */
function scopes(text: string): { controller: string[]; program: string[] } {
  const names = (block: string) => [...block.matchAll(/<Tag Name="(\w+)"/g)].map((m) => m[1]!);
  const ctl = /<Tags Use="Context">([\s\S]*?)<\/Tags>/.exec(text)![1]!;
  const prog = /<Program Use="Target"[\s\S]*?<Tags>([\s\S]*?)<\/Tags>/.exec(text)![1]!;
  return { controller: names(ctl), program: names(prog) };
}

describe("controller block (SPEC §7.7)", () => {
  it("parses tag lines, an io block and sfc tags", () => {
    const r = compile(CTRL + chart);
    expect(r.diagnostics).toEqual([]);
    expect(r.program.controllerElements?.map((n) => n.text)).toEqual(["a", "go", "b"]);
    const scope = Object.fromEntries(r.tags.map((t) => [t.name, t.scope ?? "program"]));
    expect(scope).toMatchObject({ stop: "controller", e_stop: "controller", ejections: "controller", local_x: "program", x: "program" });
  });

  it("exports controller tags and the listed elements' tags in the controller's context Tags", () => {
    const out = exportL5X(CTRL + chart, { fileName: "t.qsfc" }).text!;
    expect(scopes(out)).toEqual({
      controller: ["Action_000", "Action_001", "e_stop", "ejections", "Step_000", "Step_001", "stop", "Tran_000"],
      program: ["local_x", "Tran_001", "x"],
    });
    // the alias of a step member points to the step's operand; no module for it
    expect(out).toContain('<Tag Name="ejections" TagType="Alias" AliasFor="Step_001.Count"');
    expect(out).not.toContain('<Module Use="Reference" Name="Step_001');
  });

  it("E418: a controller alias of a program tag; one tag at two scopes", () => {
    expect(diags(CTRL.replace("sfc tags a, go, b", "sfc tags a") + chart)).toContain("5:E418");
    expect(diags("controller\n  tag x : DINT\nend\ntag x : DINT\ninit a\n  x := 1;\n-- go -> a\n")).toContain("4:E418");
  });

  it("E419 for an sfc tags name that isn't a step or transition; E223 for other lines; E206 without end", () => {
    expect(diags("controller\n  sfc tags zz\nend\ninit a\n-- go -> a\n")).toContain("2:E419");
    expect(diags("controller\n  x := 1;\nend\ninit a\n-- go -> a\n")).toContain("2:E223");
    expect(diags("controller\n  tag x : BOOL\ninit a\n  x := 1;\n-- go -> a\n")).toContain("1:E206");
  });

  it("E210 after the first routine", () => {
    expect(diags("init a\n-- go -> a\ncontroller\n  tag x : BOOL\nend\n")).toContain("3:E210");
  });

  it("E413 for an alias whose base is neither a tag, a step nor an I/O module", () => {
    const d = compile("io\n  x Local1.I.Data.0\nend\ninit a\n  x := 1;\n-- go -> a\n").diagnostics;
    expect(d.map((x) => x.message)).toContain("`Local1.I.Data.0`: `Local1` is not a tag, a step or an I/O module");
  });
});
