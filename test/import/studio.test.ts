import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportL5X } from "../../src/compile.js";
import { importL5X } from "../../src/import/index.js";
import { readSfc, type SfcChart } from "../../src/tidy/read.js";
import { scanDescendants, scanXml } from "../../src/tidy/scan.js";

/** The chart's wires, by operand (steps) and condition (transitions), sorted. */
function wires(xml: string): string[] {
  const c = readSfc(scanDescendants(scanXml(xml), "SFCContent")[0]!) as SfcChart;
  const label = (id: string): string => {
    const n = c.nodes.get(id);
    if (n) return n.kind === "transition" ? `T:${(n.text[0] ?? "").replace(/;\s*$/, "").trim()}` : n.operand;
    const b = c.branches.get(id) ?? c.branches.get(c.legOf.get(id)!);
    return b ? `${b.type}-${b.flow}` : id;
  };
  return c.links.map((l) => `${label(l.from)} > ${label(l.to)}`).sort();
}

describe("a chart drawn in Studio (legacy/tests/MainProgram.L5X)", () => {
  const xml = readFileSync("legacy/tests/MainProgram.L5X", "utf8");
  const r = importL5X(xml);

  it("imports without errors, steps named from their operands", () => {
    expect(r.error).toBeUndefined();
    expect(r.errors).toBe(0);
    expect(r.source).toMatch(/^sfc SFC$/m);
    expect(r.source).toMatch(/^init s0$/m);
    expect(r.source).toContain("-- s2.DN and d1");
  });

  it("exports again with the same wires and the same step operands", () => {
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" });
    expect(out.text).toBeDefined();
    expect(wires(out.text!)).toEqual(wires(xml));
  });

  it("keeps timer presets and initial values (SPEC §7.4)", () => {
    expect(r.source).toMatch(/^tag T2 : TIMER 3s$/m);
    expect(r.source).toMatch(/^tag T7 : TIMER 1s250ms$/m);
    expect(r.source).toMatch(/^tag Bonsens : BOOL = 1$/m);
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" }).text!;
    expect(out).toContain("<![CDATA[[0,3000,0]]]>");
    expect(out).toMatch(/<Tag Name="Bonsens"[^>]*>\s*<Data Format="L5K">\s*<!\[CDATA\[1\]\]>/);
  });

  it("keeps every Tran operand too, with tr<N> names where file order would renumber", () => {
    const ops = (x: string) =>
      [...x.matchAll(/<Transition ID="\d+"[^>]*Operand="(Tran_\d+)"[\s\S]*?<!\[CDATA\[([^\]]*)\]\]>/g)]
        .map((m) => `${m[1]}=${m[2]!.replace(/;\s*$/, "").trim()}`)
        .sort();
    const out = exportL5X(r.source, { fileName: "MainProgram.qsfc" }).text!;
    expect(ops(out)).toEqual(ops(xml));
    expect(r.source).toContain("-- tr4: s4.DN");
    expect(r.notes.filter((n) => n.level === "warning")).toEqual([]);
  });
});
